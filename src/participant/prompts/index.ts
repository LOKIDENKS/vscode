import type * as vscode from 'vscode';

import { GenericPrompt } from './generic';
import { IntentPrompt } from './intent';
import { NamespacePrompt } from './namespace';
import { QueryPrompt } from './query';
import { SchemaPrompt } from './schema';

export class Prompts {
  public static generic = new GenericPrompt();
  public static intent = new IntentPrompt();
  public static namespace = new NamespacePrompt();
  public static query = new QueryPrompt();
  public static schema = new SchemaPrompt();

  public static isPromptEmpty(request: vscode.ChatRequest): boolean {
    return !request.prompt || request.prompt.trim().length === 0;
  }
}