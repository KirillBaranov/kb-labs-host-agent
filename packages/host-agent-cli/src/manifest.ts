import { defineCommandFlags, combinePermissions, kbPlatformPreset } from '@kb-labs/sdk';
import { registerFlags, statusFlags } from './commands/flags.js';

const pluginPermissions = combinePermissions()
  .with(kbPlatformPreset)
  .withFs({
    mode: 'readWrite',
    allow: ['.kb/**', '~/.kb/**'],
  })
  .withEnv(['HOME', 'USER', 'KB_GATEWAY_URL'])
  .withQuotas({
    timeoutMs: 30000,
    memoryMb: 128,
  })
  .build();

export const manifest = {
  schema: 'kb.plugin/3',
  id: '@kb-labs/host-agent',
  version: '0.1.0',

  display: {
    name: 'Host Agent',
    description: 'Register this machine with a Gateway and check connection status.',
    tags: ['host-agent', 'gateway', 'cloud'],
  },

  platform: {
    requires: [],
    optional: ['logger'],
  },

  cli: {
    commands: [
      {
        id: 'agent:register',
        group: 'agent',
        describe: 'Register this machine with a Gateway and save credentials to ~/.kb/agent.json.',
        longDescription:
          'Calls POST /auth/register on the given Gateway URL, receives clientId/clientSecret/hostId, ' +
          'and writes ~/.kb/agent.json. Must be run once before starting the daemon via pnpm dev:start:host-agent.',

        handler: './commands/register.js#default',
        handlerPath: './commands/register.js',

        flags: defineCommandFlags(registerFlags),

        examples: [
          'kb agent:register --gateway http://localhost:4000',
          'kb agent:register --gateway https://gateway.example.com --name my-laptop --workspace /home/user/projects',
        ],
      },

      {
        id: 'agent:status',
        group: 'agent',
        describe: 'Show Host Agent connection status.',
        longDescription:
          'Connects to the daemon via IPC socket and queries its status (connected, hostId, gatewayUrl). ' +
          'Start the daemon with pnpm dev:start:host-agent.',

        handler: './commands/status.js#default',
        handlerPath: './commands/status.js',

        flags: defineCommandFlags(statusFlags),

        examples: [
          'kb agent:status',
          'kb agent:status --json',
        ],
      },
    ],
  },

  capabilities: [],
  permissions: pluginPermissions,
  artifacts: [
    {
      id: 'host-agent.config',
      pathTemplate: '~/.kb/agent.json',
      description: 'Host Agent credentials and configuration.',
    },
  ],
};

export default manifest;
