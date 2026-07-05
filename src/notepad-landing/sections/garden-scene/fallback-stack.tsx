// src/notepad-landing/sections/garden-scene/fallback-stack.tsx
import { ThreeVoices } from '../02-three-voices';
import { LivingGraph } from '../03-living-graph';
import { Connections } from '../04-connections';
import { ScriptureMargin } from '../05-scripture-margin';
import { SevenPapers } from '../06-seven-papers';
import { TierPath } from '../07-tier-path';
import { TrustImport } from '../08-trust-import';

interface FallbackStackProps { prm: boolean }

// PRM fallback: render the existing 7 section components exactly as
// today's page does. No pinned scene, no canvas, no scroll spacer.
export function FallbackStack({ prm }: FallbackStackProps) {
  return (
    <>
      <ThreeVoices prm={prm} />
      <LivingGraph prm={prm} />
      <Connections prm={prm} />
      <ScriptureMargin prm={prm} />
      <TierPath />
      <SevenPapers prm={prm} />
      <TrustImport />
    </>
  );
}
