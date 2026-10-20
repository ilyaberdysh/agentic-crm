import { describe, expect, it } from 'vitest';
import { decodeInterests, encodeInterests } from './interests';

const DEF = '11111111-1111-4111-8111-111111111111';
const REC = '22222222-2222-4222-8222-222222222222';

describe('interests in the URL', () => {
  it('round-trips a record and a call context', () => {
    const context = {
      records: [{ entityDefinitionId: DEF, entityInstanceId: REC }],
      call: { meetingId: DEF, callRecordingId: REC, startTime: 62, endTime: 90 },
    };
    const encoded = encodeInterests(context);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeInterests(encoded)).toEqual(context);
  });

  it('carries nothing for an empty context and rejects garbage', () => {
    expect(encodeInterests({})).toBeUndefined();
    expect(encodeInterests(null)).toBeUndefined();
    expect(decodeInterests('not base64 json!!')).toBeNull();
    expect(decodeInterests(btoa('{"records":[{"entityDefinitionId":"x"}]}'))).toBeNull();
    expect(decodeInterests(undefined)).toBeNull();
  });

  it('round-trips a list and a meeting context', () => {
    expect(decodeInterests(encodeInterests({ listId: DEF }))).toEqual({ listId: DEF });
    expect(decodeInterests(encodeInterests({ meeting: { meetingId: REC } }))).toEqual({ meeting: { meetingId: REC } });
  });
});
