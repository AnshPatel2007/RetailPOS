import policy from './capabilityPolicy.json';
export type Capability = keyof typeof policy;
export const can = (role: string | undefined, capability: Capability): boolean => !!role && policy[capability].includes(role);
