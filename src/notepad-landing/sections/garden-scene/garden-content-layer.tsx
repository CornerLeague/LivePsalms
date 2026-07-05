// src/notepad-landing/sections/garden-scene/garden-content-layer.tsx
import { StationThreeVoices } from './stations/01-three-voices';
import { StationLivingGraph } from './stations/02-living-graph';
import { StationConnections } from './stations/03-connections';
import { StationScriptureMargin } from './stations/04-scripture-margin';
import { StationSevenPapers } from './stations/05-seven-papers';
import { StationTierPath } from './stations/06-tier-path';
import { StationTrustImport } from './stations/07-trust-import';

interface GardenContentLayerProps {
  currentStation: number;
}

export function GardenContentLayer({ currentStation }: GardenContentLayerProps) {
  return (
    <div className="garden-content-layer">
      <StationThreeVoices       isActive={currentStation === 0} />
      <StationLivingGraph       isActive={currentStation === 1} />
      <StationConnections         isActive={currentStation === 2} />
      <StationScriptureMargin   isActive={currentStation === 3} />
      <StationTierPath          isActive={currentStation === 4} />
      <StationSevenPapers       isActive={currentStation === 5} />
      <StationTrustImport       isActive={currentStation === 6} />
    </div>
  );
}
