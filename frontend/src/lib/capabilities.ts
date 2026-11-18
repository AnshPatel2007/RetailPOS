// One policy for frontend visibility and server authorization. The server still
// checks record ownership and exact action constraints on every request.
import policy from '../../../backend/src/policies/capabilityPolicy.json';
export type Capability = keyof typeof policy;
export const can = (role: string | undefined, capability: Capability): boolean => !!role && policy[capability].includes(role);
export const rolesFor = (capability: Capability): string[] => policy[capability];
