import {
  AnnouncementBanner,
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  LoadingState,
  Skeleton,
  Text,
} from '../../../src';
import { Col, Panels, Row, Section } from '../kit';

export function Feedback() {
  return (
    <>
      <Section id="banners" title="Banner, AnnouncementBanner">
        <Panels>
          {() => (
            <>
              {(['neutral', 'info', 'warning', 'error'] as const).map((v) => (
                <Banner
                  key={v}
                  variant={v}
                  title={v === 'warning' ? 'Heads up' : undefined}
                  actions={
                    v === 'info' ? (
                      <Button variant="secondary" size={28}>
                        Learn more
                      </Button>
                    ) : undefined
                  }
                >
                  Changes to your profile will apply to all of your workspaces.
                </Banner>
              ))}
              <Banner variant="info" size="large" title="Large banner">
                Large banners use padding-block 12 and radius 16.
              </Banner>
              <AnnouncementBanner scheme="orange">
                You&apos;re offline. Please check your internet connection and <button type="button">retry</button>.
              </AnnouncementBanner>
              <AnnouncementBanner scheme="red" onDismiss={() => {}}>
                You&apos;re running an out of date version. Your page will reload in 3 minutes.
              </AnnouncementBanner>
              <AnnouncementBanner scheme="accent" icon="workspace" onDismiss={() => {}}>
                You&apos;re in a demonstration workspace.
              </AnnouncementBanner>
            </>
          )}
        </Panels>
      </Section>
      <Section id="states" title="EmptyState, LoadingState, ErrorState, Skeleton, Divider, Card">
        <Panels>
          {() => (
            <>
              <Row top>
                <EmptyState
                  icon="inbox"
                  title="No notifications"
                  description="Mentions, assignments and important updates will be displayed here."
                  actions={
                    <Button variant="secondary" size={28}>
                      Refresh
                    </Button>
                  }
                />
                <Col>
                  <LoadingState />
                  <ErrorState message="You don't have access to this workspace!" iconSize={28} />
                  <ErrorState message="Failed to load meetings" iconSize={12} />
                </Col>
              </Row>
              <Divider />
              <Row label="skeleton">
                <Skeleton shape="circle" width={24} />
                <Skeleton shape="text" />
                <Skeleton shape="text" fontSize={12} lineHeight={16} />
                <Skeleton shape="block" width={78} height={20} />
              </Row>
              <Row label="divider">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 24 }}>
                  <Text>Primary</Text>
                  <Divider orientation="vertical" />
                  <Text>Tertiary</Text>
                  <Divider orientation="vertical" variant="tertiary" />
                  <Text>Dashed</Text>
                </div>
                <div style={{ width: 160 }}>
                  <Divider variant="dashed" />
                </div>
              </Row>
              <Row top>
                {(['default', 'highlighted', 'selected', 'error'] as const).map((state) => (
                  <Card key={state} state={state} style={{ width: 150, padding: '12px 12px' }}>
                    <Text variant="text12.standard">{state}</Text>
                    <div>
                      <Text color="primary">$48,000</Text>
                    </div>
                  </Card>
                ))}
              </Row>
            </>
          )}
        </Panels>
      </Section>
    </>
  );
}
