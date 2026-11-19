import { Api, OfflineError } from './api';
import { defaultFetch, pickBase, type FetchFn } from './connection';
import { loadState, type Profile } from './profiles';
import type { AuthStatus } from './types';

export interface SessionInfo {
  where: 'home' | 'away' | null;
  version: string | null;
}

/**
 * One person's connection to the server while they browse: picks the Home or Away address once, signs requests with that
 * person's token, and when the server stops answering looks for the address again (once per request) before giving up.
 */
export class Session {
  where: 'home' | 'away' | null = null;
  private api: Api | null = null;
  private picking: Promise<void> | null = null;
  private infoP: Promise<SessionInfo> | null = null;

  constructor(public profile: Profile, public fetchFn: FetchFn = defaultFetch) {}

  private pick(force: boolean): Promise<void> {
    if (this.picking && !force) return this.picking;
    const servers = loadState().servers;
    const token = this.profile.token;
    const fetchFn = this.fetchFn;
    const self = this;
    this.picking = servers
      ? pickBase(servers, fetchFn).then(function (r) {
          self.where = r.where;
          self.api = new Api(r.base, token, fetchFn);
        })
      : Promise.reject(new OfflineError());
    return this.picking;
  }

  get<T>(path: string): Promise<T> {
    const self = this;
    const attempt = function (): Promise<T> {
      return self.pick(false).then(function () { return self.api!.get<T>(path); });
    };
    return attempt().then(undefined, function (e) {
      if (!(e instanceof OfflineError)) throw e;
      return self.pick(true).then(function () { return self.api!.get<T>(path); });
    });
  }

  /** Home or Away, and the server's version. Never rejects (a missing answer is just null). */
  info(): Promise<SessionInfo> {
    const self = this;
    if (!this.infoP) {
      this.infoP = this.get<AuthStatus>('/api/auth/status').then(
        function (st) { return { where: self.where, version: st && st.version ? st.version : null }; },
        function () { self.infoP = null; return { where: self.where, version: null }; },
      );
    }
    return this.infoP;
  }
}
