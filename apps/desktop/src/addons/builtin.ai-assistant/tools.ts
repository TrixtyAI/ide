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
  }
];
