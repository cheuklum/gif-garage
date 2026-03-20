const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readDirectory: (p) => ipcRenderer.invoke('read-directory', p),
  getVideoInfo: (p) => ipcRenderer.invoke('get-video-info', p),
  trimVideo: (opts) => ipcRenderer.invoke('trim-video', opts),
  convertToGifWithProgress: (opts) => ipcRenderer.invoke('convert-to-gif-with-progress', opts),
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
  getDownloadsDir: () => ipcRenderer.invoke('get-downloads-dir'),
  getGifGarageDir: () => ipcRenderer.invoke('get-gif-garage-dir'),
  onConversionProgress: (cb) => {
    ipcRenderer.on('conversion-progress', (event, data) => cb(data));
  },
  removeConversionProgressListener: () => {
    ipcRenderer.removeAllListeners('conversion-progress');
  }
});
