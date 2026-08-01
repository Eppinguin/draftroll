import { Draftroll, SeededRng } from '@draftroll/sdk/headless';

const draftroll = new Draftroll({ engine: undefined });
const result = draftroll.roll('4d6kh3', {
  rng: new SeededRng('request-42'),
  render: false,
  metadata: { requestId: 'request-42' },
});
console.log(JSON.stringify(result.result, null, 2));
