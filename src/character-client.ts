import './character-sheet.css';
import { initSdkDemo } from './sdk-demo';

void initSdkDemo().catch((error) => {
  const output = document.querySelector<HTMLElement>('#sdk-output');
  if (output) output.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(error);
});
