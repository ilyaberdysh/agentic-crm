import { colorTokens, hues, Icon, iconNames, palette, radius, space, Text, type TextVariant, vars } from '../../../src';
import * as g from '../gallery.css';
import { Panels, Row, Section } from '../kit';

const groups = ['interactive', 'content', 'stroke', 'surface'] as const;

function SemanticColors() {
  return (
    <Panels>
      {() =>
        groups.map((group) => (
          <div key={group} className={g.col}>
            <Text variant="text12.standard">{group}</Text>
            <div className={g.grid} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
              {Object.keys(colorTokens.light[group]).map((name) => (
                <div key={name} className={g.swatch}>
                  <div
                    className={g.swatchChip}
                    style={{ background: (vars.color[group] as Record<string, string>)[name] }}
                  />
                  <span>{name}</span>
                </div>
              ))}
            </div>
          </div>
        ))
      }
    </Panels>
  );
}

function Utilities() {
  return (
    <Panels>
      {() => (
        <div className={g.grid} style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
          {hues.map((hue) => {
            const u = vars.color.utilities;
            const s = u.surface as Record<string, string>;
            const cap = hue.charAt(0).toUpperCase() + hue.slice(1);
            return (
              <div key={hue} className={g.swatch}>
                <div className={g.swatchChip} style={{ background: s[hue] }} />
                <div
                  className={g.swatchChip}
                  style={{
                    background: s[`${hue}Subtle`],
                    color: (u.content as Record<string, string>)[`on${cap}Subtle`],
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  Aa
                </div>
                <span>{hue}</span>
              </div>
            );
          })}
        </div>
      )}
    </Panels>
  );
}

const textVariants: TextVariant[] = [
  'heading.extraLarge',
  'heading.large',
  'heading.standard',
  'heading.medium',
  'heading.small',
  'heading.extraSmall',
  'body.large',
  'body.standard',
  'body.strong',
  'body.small',
  'body.link',
  'body.interactive',
  'body.preview',
  'body.code',
  'text12.standard',
  'text12.link',
  'text11.standard',
  'text11.small',
];

export function Foundations() {
  return (
    <>
      <Section
        id="colors"
        title="Semantic colours"
        note="Theme contract (vars.color.*) resolved per identity; values from tokens.json."
      >
        <SemanticColors />
      </Section>
      <Section
        id="utilities"
        title="Utility hues"
        note="surface.<hue> and <hue>Subtle with on<Hue>Subtle text — tags, avatars, badges."
      >
        <Utilities />
      </Section>
      <Section id="palette" title="Palette">
        <div className={g.grid} style={{ gridTemplateColumns: 'repeat(19, minmax(0, 1fr))' }}>
          {Object.entries(palette.Grey).map(([step, hex]) => (
            <div key={step} className={g.swatch}>
              <div className={g.swatchChip} style={{ background: hex }} />
              <span>{step}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section
        id="typography"
        title="Typography"
        note="Inter variable; html 62.5 %; components set px. Medium (500) is the default UI weight."
      >
        <Panels>
          {() =>
            textVariants.map((v) => (
              <Row key={v} label={v}>
                <Text variant={v}>The quick brown fox · 1,234.50</Text>
              </Row>
            ))
          }
        </Panels>
      </Section>
      <Section id="elevation" title="Elevation">
        <Panels secondary>
          {() => (
            <Row>
              {(['e1', 'e2', 'e3'] as const).map((e) => (
                <div
                  key={e}
                  style={{
                    width: 120,
                    height: 72,
                    borderRadius: 12,
                    background: vars.color.surface.primary,
                    boxShadow: vars.elevation[e],
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  <Text variant="text12.standard">{e}</Text>
                </div>
              ))}
            </Row>
          )}
        </Panels>
      </Section>
      <Section id="scales" title="Spacing and radii">
        <Panels>
          {() => (
            <>
              <Row label="spacing">
                {Object.values(space).map((v) => (
                  <div
                    key={v}
                    title={`${v}px`}
                    style={{ width: v, height: 16, background: vars.color.surface.accent, borderRadius: 2 }}
                  />
                ))}
              </Row>
              <Row label="radius">
                {Object.entries(radius).map(([k, v]) => (
                  <div
                    key={k}
                    title={k}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: typeof v === 'number' ? v : v,
                      boxShadow: `inset 0 0 0 1px ${vars.color.stroke.tertiary}`,
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 10,
                    }}
                  >
                    {k}
                  </div>
                ))}
              </Row>
            </>
          )}
        </Panels>
      </Section>
      <Section
        id="icons"
        title="Icons"
        note="Lucide via <Icon>; stroke per optical size (12 → 2, 16 → 1.5, 18 → 1.33) keeps a consistent 1 px weight."
      >
        <Panels>
          {() => (
            <>
              {[12, 16, 18].map((size) => (
                <Row key={size} label={`${size}px`}>
                  {iconNames.slice(0, 48).map((name) => (
                    <span key={name} title={name}>
                      <Icon icon={name} size={size} />
                    </span>
                  ))}
                </Row>
              ))}
              <div className={g.grid} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                {iconNames.map((name) => (
                  <Row key={name}>
                    <Icon icon={name} size={16} />
                    <Text variant="text12.standard" className={g.mono}>
                      {name}
                    </Text>
                  </Row>
                ))}
              </div>
            </>
          )}
        </Panels>
      </Section>
    </>
  );
}
