export const IDE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and directories in a given path',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The absolute or relative path to list' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the full content of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The path of the file to read' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or update a file with new content',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The path of the file to write to' },
          content: { type: 'string', description: 'The new content for the file' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_command',
      description: 'Run a non-interactive shell command (e.g., pnpm install, git status)',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The base command to run' },
          args: { type: 'array', items: { type: 'string' }, description: 'Arguments for the command' },
          cwd: { type: 'string', description: 'Current working directory' }
        },
        required: ['command', 'args']
      }
    }
  },
  {
      type: 'function',
      function: {
          name: 'get_workspace_structure',
          description: 'Get the full recursive structure of the current project workspace',
          parameters: {
              type: 'object',
              properties: {},
              required: []
          }
      }
  },
  {
      type: 'function',
      function: {
          name: 'web_search',
          description: 'Access the internet to search for information or visit a specific URL. If you provide a URL, I will read its content directly. If you provide a topic, I will search for results.',
          parameters: {
              type: 'object',
              properties: {
                  query: { type: 'string', description: 'The search query or URL (e.g., "latest Next.js version" or "https://nextjs.org/docs")' }
              },
              required: ['query']
          }
      }
  },
  {
      type: 'function',
      function: {
          name: 'remember',
          description: 'Store or update information in your long-term persistent memory (.agents/MEMORY.md). Use this to remember user preferences, architectural decisions, or facts that should persist across chat sessions.',
          parameters: {
              type: 'object',
              properties: {
                  content: { type: 'string', description: 'The updated content for your entire memory file. You should append or update existing points rather than overwriting completely unless intended.' }
              },
              required: ['content']
          }
      }
  }
];
