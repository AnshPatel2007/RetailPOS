// Requests from an earlier login must never update or sign out a newer session.
let generation = 0;
export const sessionGeneration = () => generation;
export const changeSessionGeneration = () => ++generation;
