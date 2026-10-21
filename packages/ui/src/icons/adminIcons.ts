// Settings administration icons for teams, members, permissions, rules and developers → Lucide glyphs. Kept in
// their own map (spread into iconMap) so parallel slices add icons without touching the same lines.
import { Bookmark, Briefcase, Camera, Flag, Gauge, Layers, Lightbulb, Rocket, Shield, Webhook } from 'lucide-react';
import type { IconGlyph } from './types';

export const adminIconMap = {
  bookmark: Bookmark,
  camera: Camera,
  webhook: Webhook,
  teamFlag: Flag,
  teamRocket: Rocket,
  rocket: Rocket,
  teamShield: Shield,
  teamLayers: Layers,
  teamIdea: Lightbulb,
  teamGauge: Gauge,
  teamCase: Briefcase,
} satisfies Record<string, IconGlyph>;
