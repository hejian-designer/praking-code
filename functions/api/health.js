import { resolveHealth } from '../../src/parking.js';

export async function onRequestGet(context) {
  return resolveHealth(context.request, context.env);
}
