import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { shrinkPicture } from '../avatarImage';
import { useAuth } from './AuthGate';
import Spinner from './Spinner';

/** A person's picture, or the first letter of their name when they have none. */
export function Avatar({ username, avatar, size = 34 }: { username?: string; avatar?: string | null; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.44) };
  if (avatar) return <img className="avatar avatar-img" src={avatar} alt="" style={style} />;
  return (
    <span className="avatar" aria-hidden style={style}>
      {(username ?? '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Account settings: upload or remove your own picture (shown here, in the sidebar and on the TV app). */
export default function ProfilePicturePanel() {
  const auth = useAuth();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const user = auth.data?.user;
  const refresh = () => qc.invalidateQueries({ queryKey: ['auth'] });
  const upload = useMutation({
    mutationFn: async (f: File) => api.put<{ avatar: string }>('/api/auth/avatar', { image: await shrinkPicture(f) }),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => api.del('/api/auth/avatar'), onSuccess: refresh });
  const busy = upload.isPending || remove.isPending;
  const error = (upload.error || remove.error) as Error | null;
  if (!user) return null;
  return (
    <section className="panel">
      <h2>Profile picture</h2>
      <div className="row profile-picture-row">
        <Avatar username={user.username} avatar={user.avatar} size={96} />
        <div className="stack">
          <p className="muted small">Shown next to your name here and on the Foxbloom TV app. Pictures are cropped to a square.</p>
          <div className="row">
            <button type="button" className="btn small" disabled={busy} onClick={() => file.current?.click()}>
              {upload.isPending && <Spinner />} {user.avatar ? 'Change picture' : 'Upload picture'}
            </button>
            {user.avatar && (
              <button type="button" className="btn small ghost" disabled={busy} onClick={() => remove.mutate()}>
                {remove.isPending && <Spinner />} Remove
              </button>
            )}
          </div>
          {error && <div className="error-box">{error.message}</div>}
        </div>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) upload.mutate(f);
        }}
      />
    </section>
  );
}
