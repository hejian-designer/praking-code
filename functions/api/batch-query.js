import { resolveBatchQuery } from '../../src/parking.js';

export async function onRequestPost(context) {
  return resolveBatchQuery(context.request, context.env);
}
