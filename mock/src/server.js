import { createApp } from './app.js';

const port = Number(process.env.PORT) || 4000;
createApp().listen(port, () => {
  console.log(`PesaPop mock API listening on http://localhost:${port} (demo data only)`);
});
