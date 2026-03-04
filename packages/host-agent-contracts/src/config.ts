import { z } from 'zod';

/** Token pair returned by Gateway /auth/token and /auth/refresh */
export const TokenPairSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresIn: z.number().positive(),
  tokenType: z.literal('Bearer'),
});

/**
 * ~/.kb/agent.json — persisted on the developer's machine after `kb agent register`
 */
export const AgentConfigSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  hostId: z.string(),
  gatewayUrl: z.string().url().refine(
    (url) => url.startsWith('https://') || url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1'),
    { message: 'gatewayUrl must use HTTPS (HTTP only allowed for localhost in dev)' },
  ),
  /** X25519 private key, base64url — never leaves the machine */
  privateKey: z.string().optional(),
  /** X25519 public key, base64url — sent to Gateway on hello */
  publicKey: z.string().optional(),
  namespaceId: z.string().default('default'),
  /**
   * Explicit list of workspace paths the agent is allowed to access.
   * Principle of least privilege: no access outside these paths.
   */
  workspacePaths: z.array(z.string()).min(1),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
