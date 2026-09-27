import { computeInsights, type InsightsInput } from '../shared/insights';

self.onmessage = (event: MessageEvent<InsightsInput>) => {
  self.postMessage(computeInsights(event.data));
};
