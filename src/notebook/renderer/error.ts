import type { ActivationFunction } from 'vscode-notebook-renderer';
import { render } from './errorRenderer';

import { outputItem } from './outputItem';

export const activate: ActivationFunction = (context) => {
  return outputItem(context, render);
};