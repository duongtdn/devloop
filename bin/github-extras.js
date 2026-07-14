#!/usr/bin/env node
// devloop github-extras MCP server
// Fills the gaps in the official GitHub MCP server: milestone operations
// (create/list/close/assign) and label operations (list/create).
// Requires GITHUB_TOKEN in the environment.

'use strict';

const https = require('https');

// ---------------------------------------------------------------------------
// GitHub REST API helper
// ---------------------------------------------------------------------------

function githubRequest(method, repoPath, body = null) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return Promise.reject(new Error(
      'GITHUB_TOKEN environment variable is not set. ' +
      'Set it to a GitHub personal access token with repo scope.'
    ));
  }

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${repoPath}`,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'devloop-plugin/github-extras-mcp',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.statusCode === 204 ? null : JSON.parse(data));
        } else {
          let message = `GitHub API ${res.statusCode}`;
          try {
            const parsed = JSON.parse(data);
            message += `: ${parsed.message || data}`;
          } catch (_) {
            message += `: ${data}`;
          }
          reject(new Error(message));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tool implementations — milestones
// ---------------------------------------------------------------------------

async function createMilestone({ owner, repo, title, description }) {
  const result = await githubRequest(
    'POST',
    `${owner}/${repo}/milestones`,
    { title, description: description || '' }
  );
  return {
    number: result.number,
    title: result.title,
    description: result.description,
    state: result.state,
    url: result.html_url,
  };
}

async function listMilestones({ owner, repo, state = 'open' }) {
  const results = await githubRequest(
    'GET',
    `${owner}/${repo}/milestones?state=${state}&per_page=100`
  );
  return results.map((m) => ({
    number: m.number,
    title: m.title,
    description: m.description,
    state: m.state,
    due_on: m.due_on,          // ISO timestamp, or null when no due date is set
    open_issues: m.open_issues,
    closed_issues: m.closed_issues,
    url: m.html_url,
  }));
}

async function closeMilestone({ owner, repo, milestone_number }) {
  await githubRequest(
    'PATCH',
    `${owner}/${repo}/milestones/${milestone_number}`,
    { state: 'closed' }
  );
  return { milestone_number, state: 'closed' };
}

async function assignIssuesToMilestone({ owner, repo, milestone_number, issue_numbers }) {
  // milestone_number: null is the documented REST way to remove an issue from its
  // milestone — how an issue is carried over, sent to backlog, or dropped from a sprint.
  const clearing = milestone_number === null;

  if (milestone_number === undefined) {
    throw new Error(
      'milestone_number is required. Pass a milestone number to assign, or null to remove ' +
      'the issues from their milestone.'
    );
  }

  if (!Array.isArray(issue_numbers) || issue_numbers.length === 0) {
    return { assigned: [], skipped: 'issue_numbers was empty' };
  }

  const results = [];
  const failures = [];

  for (const issue_number of issue_numbers) {
    try {
      await githubRequest(
        'PATCH',
        `${owner}/${repo}/issues/${issue_number}`,
        { milestone: milestone_number }
      );
      results.push(issue_number);
    } catch (err) {
      failures.push({ issue_number, error: err.message });
    }
  }

  return clearing
    ? { cleared: results, failed: failures }
    : { assigned: results, failed: failures };
}

// ---------------------------------------------------------------------------
// Tool implementations — labels
// ---------------------------------------------------------------------------

async function listLabels({ owner, repo }) {
  const results = await githubRequest(
    'GET',
    `${owner}/${repo}/labels?per_page=100`
  );
  return results.map((l) => ({
    name: l.name,
    color: l.color,
    description: l.description,
  }));
}

async function createLabel({ owner, repo, name, color, description }) {
  const body = { name };
  // GitHub requires a 6-char hex color (no leading '#'). Default to a neutral grey.
  body.color = (color || 'ededed').replace(/^#/, '');
  if (description) body.description = description;

  const result = await githubRequest(
    'POST',
    `${owner}/${repo}/labels`,
    body
  );
  return {
    name: result.name,
    color: result.color,
    description: result.description,
    url: result.url,
  };
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const TOOLS = {
  create_milestone: createMilestone,
  list_milestones: listMilestones,
  close_milestone: closeMilestone,
  assign_issues_to_milestone: assignIssuesToMilestone,
  list_labels: listLabels,
  create_label: createLabel,
};

const TOOL_DEFINITIONS = [
  {
    name: 'create_milestone',
    description: 'Create a GitHub milestone in a repository. Returns the milestone number needed for issue assignment.',
    inputSchema: {
      type: 'object',
      properties: {
        owner:       { type: 'string', description: 'Repository owner (user or org)' },
        repo:        { type: 'string', description: 'Repository name' },
        title:       { type: 'string', description: 'Milestone title (e.g. "Sprint 3")' },
        description: { type: 'string', description: 'Milestone description — used as the sprint goal' },
      },
      required: ['owner', 'repo', 'title'],
    },
  },
  {
    name: 'list_milestones',
    description: 'List milestones for a GitHub repository, with each one\'s state, due date, and open/closed issue counts. This is also the only way to READ a single milestone (the official GitHub MCP server has no milestone tools at all) — list with state "all" and pick the one whose number you want.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo:  { type: 'string', description: 'Repository name' },
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          description: 'Filter by milestone state. Defaults to open. Use "all" when looking up a milestone by number, since it may already be closed.',
        },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'close_milestone',
    description: 'Close a GitHub milestone (marks the sprint as complete).',
    inputSchema: {
      type: 'object',
      properties: {
        owner:            { type: 'string', description: 'Repository owner' },
        repo:             { type: 'string', description: 'Repository name' },
        milestone_number: { type: 'number', description: 'Milestone number to close' },
      },
      required: ['owner', 'repo', 'milestone_number'],
    },
  },
  {
    name: 'assign_issues_to_milestone',
    description: 'Assign one or more issues to a GitHub milestone, or REMOVE them from their milestone by passing milestone_number: null. Removal is how an issue is carried over to a later sprint, sent back to the backlog, or dropped — an issue that keeps its milestone is invisible to the next sprint\'s issue selection. Returns which issues succeeded and which failed.',
    inputSchema: {
      type: 'object',
      properties: {
        owner:            { type: 'string',  description: 'Repository owner' },
        repo:             { type: 'string',  description: 'Repository name' },
        milestone_number: {
          type: ['number', 'null'],
          description: 'Milestone number to assign the issues to, or null to remove them from their current milestone. Required — null must be explicit, so no accidental omission ever clears a milestone.',
        },
        issue_numbers:    {
          type: 'array',
          items: { type: 'number' },
          description: 'Issue numbers to assign or clear',
        },
      },
      required: ['owner', 'repo', 'milestone_number', 'issue_numbers'],
    },
  },
  {
    name: 'list_labels',
    description: 'List all labels defined in a GitHub repository. Use before create_label to see which labels already exist.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo:  { type: 'string', description: 'Repository name' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'create_label',
    description: 'Create a label in a GitHub repository. Fails if a label with the same name already exists — call list_labels first to skip existing ones.',
    inputSchema: {
      type: 'object',
      properties: {
        owner:       { type: 'string', description: 'Repository owner' },
        repo:        { type: 'string', description: 'Repository name' },
        name:        { type: 'string', description: 'Label name (e.g. "epic:foundation")' },
        color:       { type: 'string', description: '6-char hex color without "#" (e.g. "0e8a16"). Defaults to a neutral grey.' },
        description: { type: 'string', description: 'Optional label description' },
      },
      required: ['owner', 'repo', 'name'],
    },
  },
];

// ---------------------------------------------------------------------------
// MCP stdio transport
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = '2024-11-05';

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function handleMessage(message) {
  const { id, method, params } = message;

  if (method === 'initialize') {
    respond(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'github-extras', version: '0.2.0' },
    });
    return;
  }

  // Notifications — no response
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'notifications/cancelled') return;

  if (method === 'ping') {
    respond(id, {});
    return;
  }

  if (method === 'tools/list') {
    respond(id, { tools: TOOL_DEFINITIONS });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    const fn = TOOLS[name];

    if (!fn) {
      respond(id, {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      });
      return;
    }

    fn(args || {})
      .then((result) => {
        respond(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      })
      .catch((err) => {
        respond(id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        });
      });
    return;
  }

  if (id !== undefined && id !== null) {
    respondError(id, -32601, `Method not found: ${method}`);
  }
}

// Read newline-delimited JSON from stdin
let buffer = '';

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop(); // hold last incomplete line
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      handleMessage(JSON.parse(trimmed));
    } catch (_) {
      // ignore malformed lines
    }
  }
});

process.stdin.on('end', () => {
  // process anything remaining in buffer
  const trimmed = buffer.trim();
  if (trimmed) {
    try { handleMessage(JSON.parse(trimmed)); } catch (_) {}
  }
  process.exit(0);
});
