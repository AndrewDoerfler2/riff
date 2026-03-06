import { spawn } from 'node:child_process';

const MCP_PROTOCOL_VERSION = '2024-11-05';

function extractTextContent(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content
    .filter(item => item && item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('\n')
    .trim();
}

export async function callMcpTool({
  command,
  args,
  env,
  toolName,
  toolArguments,
  timeoutMs,
}) {
  const child = spawn(command, args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let nextId = 1;
  let stdoutBuffer = '';
  let stderrBuffer = '';
  const pending = new Map();

  const cleanup = () => {
    child.stdout.removeAllListeners();
    child.stderr.removeAllListeners();
    child.removeAllListeners();
    for (const { reject } of pending.values()) {
      reject(new Error('MCP subprocess exited before responding.'));
    }
    pending.clear();
  };

  const killChild = () => {
    if (!child.killed) {
      child.kill();
    }
  };

  const request = (method, params) => {
    const id = nextId++;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${payload}\n`, (error) => {
        if (error) {
          pending.delete(id);
          reject(error);
        }
      });
    });
  };

  const notify = (method, params) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    });
    child.stdin.write(`${payload}\n`);
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    let newlineIndex = stdoutBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        const message = JSON.parse(line);
        if (typeof message.id === 'number' && pending.has(message.id)) {
          const { resolve, reject } = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) reject(new Error(message.error.message ?? 'Unknown MCP error.'));
          else resolve(message.result);
        }
      }
      newlineIndex = stdoutBuffer.indexOf('\n');
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk;
  });

  const exitPromise = new Promise((_, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      cleanup();
      if (code !== 0 && signal !== 'SIGTERM') {
        reject(new Error(`MCP subprocess exited with code ${code ?? 'null'}${stderrBuffer ? `: ${stderrBuffer.trim()}` : ''}`));
      }
    });
  });

  const runPromise = (async () => {
    await request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'riff-server',
        version: '0.1.0',
      },
    });
    notify('notifications/initialized', {});

    const toolResult = await request('tools/call', {
      name: toolName,
      arguments: toolArguments,
    });

    if (toolResult?.isError) {
      throw new Error(extractTextContent(toolResult) || 'MCP tool call returned an error.');
    }

    const text = extractTextContent(toolResult);
    if (!text) {
      throw new Error('MCP tool call returned no text content.');
    }

    return text;
  })();

  try {
    return await Promise.race([
      runPromise,
      exitPromise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`MCP request timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    killChild();
  }
}
