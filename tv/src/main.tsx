import { render } from 'preact';
import { App } from './app';
import { Home } from './home';
import { registerTvKeys } from './remote';
import './styles.css';

registerTvKeys();
render(<App initial={{ name: 'home', render: () => <Home /> }} />, document.getElementById('app')!);
