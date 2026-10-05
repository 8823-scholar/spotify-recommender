import { reviewPort } from './config.js';
import { openInBrowser, startReviewServer } from './review.js';

const { url } = await startReviewServer(reviewPort());
console.log(`おすすめの整理画面: ${url}`);
console.log('終了するには Ctrl+C');
openInBrowser(url);
