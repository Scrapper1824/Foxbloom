import { Api, OfflineError } from './api';
import { defaultFetch, pickBase, type FetchFn } from './connection';
import { loadState, saveState, setAvatar, type Profile } from './profiles';
import type { AuthStatus } from './types';

export interface SessionInfo {
  where: 'home' | 'away' | null;
  version: string | null;
  /** The address in use (for the person's picture); '' when the server could not be reached. */
  base: string;
}

/**
 * One person's connection to the server while they browse: picks the Home or Away address once, signs requests with that
 * person's token, and when the server stops answering looks for the address again (once per request) before giving up.
 */
export class Session {
  where: 'home' | 'away' | null = null;
  /** The Search screen's text, kept here so Back from a result finds it again. */
  searchQuery = '';
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
    return this.send<T>('GET', path);
  }

  send<T>(method: string, path: string, body?: unknown): Promise<T> {
    const self = this;
    const attempt = function (): Promise<T> {
      return self.pick(false).then(function () { return self.api!.send<T>(method, path, body); });
    };
    return attempt().then(undefined, function (e) {
      if (!(e instanceof OfflineError)) throw e;
      return self.pick(true).then(function () { return self.api!.send<T>(method, path, body); });
    });
  }

  /** A video or subtitle URL on the address in use, with the stream token (`st`) the TV uses instead of a header. */
  streamUrl(url: string, streamToken: string | undefined): string {
    if (!this.api) throw new OfflineError();
    return streamToken ? this.api.streamUrl(url, streamToken) : this.api.streamUrl(url, '').replace(/[?&]st=$/, '');
  }

  /** Home or Away, and the server's version. Never rejects (a missing answer is just null). */
  info(): Promise<SessionInfo> {
    const self = this;
    if (!this.infoP) {
      this.infoP = this.get<AuthStatus>('/api/auth/status').then(
        function (st) {
          // The signed-in status lists the server's home addresses: keep them fresh, so a new LAN IP is learned here
          // rather than only when a person is added.
          if (st && Array.isArray(st.localUrls)) {
            const s = loadState();
            if (s.servers) saveState({ servers: { publicUrl: s.servers.publicUrl, localUrls: st.localUrls }, profiles: s.profiles });
          }
          // The person's picture may have changed on the website: keep it with the profile.
          if (st && st.user && st.user.avatar !== undefined) {
            const avatar = st.user.avatar || null;
            setAvatar(self.profile.userId, avatar);
            self.profile = { ...self.profile, avatar: avatar };
          }
          return { where: self.where, version: st && st.version ? st.version : null, base: self.api ? self.api.base : '' };
        },
        function () { self.infoP = null; return { where: self.where, version: null, base: '' }; },
      );
    }
    return this.infoP;
  }
}
