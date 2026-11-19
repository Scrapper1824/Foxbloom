import { describe, expect, it, vi } from 'vitest';
import { createLinkFlow, initialCode, normaliseCode, successText, type LinkApi } from './linkTv';

class Err extends Error {
  constructor(m: string, public status: number) {
    super(m);
  }
}

function fake(over: Partial<Record<string, unknown>> = {}) {
  const calls: { url: string; body: unknown }[] = [];
  const api: LinkApi = async (url, body) => {
    calls.push({ url, body });
    const r = over[url];
    if (r instanceof Error) throw r;
    return (r ?? (url.endsWith('/check') ? { deviceName: 'Living room TV' } : { ok: true, deviceName: 'Living room TV' })) as never;
  };
  return { api, calls };
}

describe('normaliseCode', () => {
  it('uppercases, trims, and accepts the code with or without the dash', () => {
    expect(normaliseCode(' fxb-k7m2 ')).toBe('FXB-K7M2');
    expect(normaliseCode('fxbk7m2')).toBe('FXB-K7M2');
    expect(normaliseCode('k7m2')).toBe('FXB-K7M2');
    expect(normaliseCode('fxb k7m2')).toBe('FXB-K7M2');
  });
  it('leaves a partial code readable while typing', () => {
    expect(normaliseCode('fx')).toBe('FX');
    expect(normaliseCode('')).toBe('');
  });
});

describe('initialCode', () => {
  it('prefills from ?code=', () => {
    expect(initialCode('?code=fxb-k7m2')).toBe('FXB-K7M2');
    expect(initialCode('?x=1')).toBe('');
  });
});

describe('link flow', () => {
  it('checks first and does not link until confirmed', async () => {
    const { api, calls } = fake();
    const flow = createLinkFlow(api, 'sam');
    await flow.check('fxb-k7m2');
    expect(calls).toEqual([{ url: '/api/tv/link/check', body: { code: 'FXB-K7M2' } }]);
    expect(flow.state).toMatchObject({ step: 'confirm', deviceName: 'Living room TV' });
    expect(flow.prompt()).toBe('Sign in Living room TV as sam?');
  });
  it('links only after confirm, then shows the success text', async () => {
    const { api, calls } = fake();
    const flow = createLinkFlow(api, 'sam');
    await flow.check('K7M2');
    await flow.confirm();
    expect(calls.map((c) => c.url)).toEqual(['/api/tv/link/check', '/api/tv/link']);
    expect(calls[1].body).toEqual({ code: 'FXB-K7M2' });
    expect(flow.state).toMatchObject({ step: 'done' });
    expect(successText('sam')).toBe('Your TV is signed in as sam. You can put your phone down.');
  });
  it('confirm without a check does nothing', async () => {
    const { api, calls } = fake();
    const flow = createLinkFlow(api, 'sam');
    await flow.confirm();
    expect(calls).toEqual([]);
  });
  it('cancel returns to entry without linking', async () => {
    const { api, calls } = fake();
    const flow = createLinkFlow(api, 'sam');
    await flow.check('K7M2');
    flow.cancel();
    expect(flow.state.step).toBe('enter');
    expect(calls).toHaveLength(1);
  });
  it.each([
    [404, 'That code is wrong or has expired.'],
    [429, 'Too many tries. Wait a minute.'],
  ])('shows the server error on %i', async (status, text) => {
    const { api } = fake({ '/api/tv/link/check': new Err(text, status) });
    const flow = createLinkFlow(api, 'sam');
    await flow.check('K7M2');
    expect(flow.state).toMatchObject({ step: 'enter', error: text });
  });
  it('shows the server error when the final link fails', async () => {
    const { api } = fake({ '/api/tv/link': new Err('That code is wrong or has expired.', 404) });
    const flow = createLinkFlow(api, 'sam');
    await flow.check('K7M2');
    await flow.confirm();
    expect(flow.state).toMatchObject({ step: 'enter', error: 'That code is wrong or has expired.' });
  });
  it('notifies listeners on change', async () => {
    const { api } = fake();
    const flow = createLinkFlow(api, 'sam');
    const spy = vi.fn();
    flow.subscribe(spy);
    await flow.check('K7M2');
    expect(spy).toHaveBeenCalled();
  });
});
