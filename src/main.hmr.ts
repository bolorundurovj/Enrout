/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { bootstrap } from './main';

void bootstrap().then((app) => {
  if (module.hot) {
    module.hot.accept();
    module.hot.dispose(() => void app.close());
  }
});
