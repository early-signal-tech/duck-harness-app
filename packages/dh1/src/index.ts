// The DH-1 device: the agent plugin's face, its engine connection, and the protocol.
export { Dh1, Dh1Face, Dh1PromptBar } from "./Dh1";
export { useDh1 } from "./useDh1";
export type { Dh1Model, Dh1Options } from "./useDh1";
export { useEngine } from "./useEngine";
export type { EngineConnection } from "./useEngine";
export * from "./harness";
export { Dh1Card, sourceSummary } from "./Dh1Card";
export type { Dh1Section } from "./Dh1Card";
export { Dh1Output } from "./Dh1Output";
export type { TakeKind } from "./Dh1Output";
export { progressOf } from "./setlist";
// For CH-1, which plays DH-1's engine: the live run view and answer rendering.
export { IDLE, runReducer } from "./runState";
export type { ActivityLine, RunView } from "./runState";
export { isAnswer, StructuredAnswer } from "./components/StructuredAnswer";
export type { Answer } from "./components/StructuredAnswer";
