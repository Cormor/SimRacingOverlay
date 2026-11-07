'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Watch the directory so an editor's atomic rename does not detach the watcher.
// A missing filename means reconcile this small group, not ignore the event.
function watchFiles(directory, names, onChange, onError, matches) {
  const files = new Set(names);
  let watcher, timer, closed = false;
  let fallback = false;
  const pending = new Set();
  function changed(name) {
    if (closed) return;
    if (!name) for (const file of files) pending.add(file);
    else {
      const file = String(name);
      if (matches?.(file) || files.has(file)) {
        files.add(file);
        pending.add(file);
      }
    }
    if (!pending.size) return;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const batch = [...pending]; pending.clear();
      if (!closed) onChange(batch);
    }, 100);
  }
  function failed(error) {
    if (closed || fallback) return;
    watcher?.close(); watcher = null; fallback = true;
    onError(error);
    // Some mounted filesystems cannot watch directories. Keep only the affected
    // files live in that case; normal Windows operation has no polling.
    for (const file of files) fs.watchFile(path.join(directory, file),
      {interval: 5000, persistent: false}, () => changed(file));
  }
  try {
    watcher = fs.watch(directory, {persistent: false}, (_event, name) => changed(name));
    watcher.on('error', failed);
  } catch (error) { failed(error); }
  return () => {
    closed = true; clearTimeout(timer); watcher?.close();
    if (fallback) for (const file of files) fs.unwatchFile(path.join(directory, file));
  };
}

module.exports = {watchFiles};
