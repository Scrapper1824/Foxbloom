import { render } from 'preact';
import { App } from './app';
import { loadState } from './profiles';
import { Connect } from './screens/Connect';
import { Profiles } from './screens/Profiles';
import { registerTvKeys } from './remote';
import { androidBridge, fitAndroidViewport } from './platform';
import './styles.css';

if (androidBridge()) fitAndroidViewport(document, screen.width);
registerTvKeys();
render(<App initial={loadState().servers ? { name: 'profiles', render: () => <Profiles /> } : { name: 'connect', render: () => <Connect /> }} />, document.getElementById('app')!);
