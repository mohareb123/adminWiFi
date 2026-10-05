/**
 * Signature module barrel — the updateable signature database (spec §4).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

export { RouterSignatures } from './database';
export type { SignaturePack, SignatureValidationIssue } from './database';
export { BUILTIN_SIGNATURES, BUILTIN_META } from './builtin';
export { OUI_TABLE, lookupOui, guessDeviceKind } from './oui';
export type {
  RouterSignature,
  SignatureMatchSpec,
  SignatureOperation,
  SignatureApiMap,
  WeightedPattern,
  SignatureDatabaseMeta,
  LearnedProfile,
} from './types';
