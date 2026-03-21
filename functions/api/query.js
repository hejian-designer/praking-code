import { resolveQuery } from '../../src/parking.js';

export async function onRequestPost(context) {
  return resolveQuery(context.request, context.env);
}
