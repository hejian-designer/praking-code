const DEMO_RECORDS = {
  '沪GAJ226': {
    plate: '沪GAJ226',
    status: 'success',
    owner: 'xiner',
    entry: '2026-03-20 08:53',
    need_pay: 30,
    today_hours: 1.3,
    total_hours: 24.5
  },
  '沪A32Q90': {
    plate: '沪A32Q90',
    status: 'not_found',
    owner: '',
    entry: '',
    need_pay: 0,
    today_hours: 0,
    total_hours: 0
  },
  '沪B12345': {
    plate: '沪B12345',
    status: 'success',
    owner: 'demo-owner',
    entry: '2026-03-22 10:12',
    need_pay: 15,
    today_hours: 2.5,
    total_hours: 2.5
  }
};

function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return fallback;
}

function normalizePlate(plate = '') {
  return String(plate).trim().toUpperCase();
}

function ok(data = null, message = 'ok', status = 200) {
  return new Response(JSON.stringify({ success: true, message, data }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function fail(message = 'error', status = 400, extra = {}) {
  return new Response(JSON.stringify({ success: false, message, data: null, ...extra }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function forwardToUpstream(request, env, pathname) {
  const upstream = env.PARKING_UPSTREAM_URL;
  if (!upstream) {
    return fail('未配置 PARKING_UPSTREAM_URL', 500);
  }

  const url = new URL(pathname, upstream.endsWith('/') ? upstream : `${upstream}/`);
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  const token = env.PARKING_API_TOKEN;
  const tokenHeader = env.PARKING_API_TOKEN_HEADER || 'Authorization';
  if (token) {
    headers.set(tokenHeader, token);
  }

  const init = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.text();
  }

  const resp = await fetch(url.toString(), init);
  const body = await resp.text();
  return new Response(body, {
    status: resp.status,
    headers: { 'content-type': resp.headers.get('content-type') || 'application/json; charset=utf-8' }
  });
}

function mockQueryOne(plate) {
  const normalized = normalizePlate(plate);
  if (!normalized) {
    return { plate: '', status: 'not_found', owner: '', entry: '', need_pay: 0, today_hours: 0, total_hours: 0 };
  }
  return DEMO_RECORDS[normalized] || {
    plate: normalized,
    status: normalized.endsWith('5') || normalized.endsWith('8') ? 'success' : 'not_found',
    owner: normalized.endsWith('5') ? 'demo-user' : '',
    entry: normalized.endsWith('5') || normalized.endsWith('8') ? '2026-03-22 09:30' : '',
    need_pay: normalized.endsWith('5') ? 20 : normalized.endsWith('8') ? 10 : 0,
    today_hours: normalized.endsWith('5') ? 3.5 : normalized.endsWith('8') ? 1.2 : 0,
    total_hours: normalized.endsWith('5') ? 6.8 : normalized.endsWith('8') ? 1.2 : 0
  };
}

async function resolveQuery(request, env) {
  const demoMode = asBool(env.DEMO_MODE, true);
  if (env.PARKING_UPSTREAM_URL) {
    return forwardToUpstream(request, env, '/api/query');
  }
  if (!demoMode) {
    return fail('未配置上游查询服务，且 DEMO_MODE=false', 500);
  }

  const payload = await readJson(request);
  const plate = normalizePlate(payload.plate || '');
  if (!plate) {
    return fail('请提供车牌号', 400);
  }
  return ok(mockQueryOne(plate));
}

async function resolveBatchQuery(request, env) {
  const demoMode = asBool(env.DEMO_MODE, true);
  if (env.PARKING_UPSTREAM_URL) {
    return forwardToUpstream(request, env, '/api/batch-query');
  }
  if (!demoMode) {
    return fail('未配置上游查询服务，且 DEMO_MODE=false', 500);
  }

  const payload = await readJson(request);
  const plates = Array.isArray(payload.plates) ? payload.plates.map(normalizePlate).filter(Boolean) : [];
  return ok(plates.map(mockQueryOne));
}

async function resolveHealth(request, env) {
  const demoMode = asBool(env.DEMO_MODE, true);
  if (env.PARKING_UPSTREAM_URL) {
    return forwardToUpstream(request, env, '/api/health');
  }
  return ok({ status: demoMode ? 'demo-ok' : 'ok', mode: demoMode ? 'demo' : 'no-upstream' });
}

export { ok, fail, readJson, resolveQuery, resolveBatchQuery, resolveHealth };
