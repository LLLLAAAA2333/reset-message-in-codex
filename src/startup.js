function startIconWatcher(desktop, settings) {
  const { spawn } = require('node:child_process');
  let child, restart, stopped = false;
  const receipt = path.join(DATA_DIR, 'startup-status.json');
  function launch() {
    if (stopped) return;
    child = spawn(path.join(__dirname, 'native/startup'), [desktop.app, String(settings.port), receipt], { stdio: ['ignore', 'ignore', 'inherit'] });
    let handled = false;
    const ended = () => {
      if (handled) return; handled = true; child = null;
      if (!stopped) restart = setTimeout(launch, 5000);
    };
    child.once('error', ended); child.once('exit', ended);
  }
  launch();
  return {
    status() {
      let state = {};
      try { state = JSON.parse(fs.readFileSync(receipt, 'utf8')); } catch {}
      return { running: !!child?.pid, ...state };
    },
    stop() { stopped = true; clearTimeout(restart); child?.kill('SIGTERM'); }
  };
}
