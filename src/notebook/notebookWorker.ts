import { CliServiceProvider } from '@mongosh/service-provider-server';
import { ElectronRuntime } from '@mongosh/browser-runtime-electron';
import { parentPort, workerData } from 'worker_threads';
import {
  PlaygroundResult,
  PlaygroundDebug,
  ShellExecuteAllResult,
  EvaluationResult,
} from '../types/playgroundType';
import { getContent, getLanguage } from '../utils/output';

// MongoClientOptions is the second argument of CliServiceProvider.connect(connectionStr, options)
type MongoClientOptions = NonNullable<
  Parameters<typeof CliServiceProvider['connect']>[1]
>;

type WorkerResult = ShellExecuteAllResult;
type WorkerError = any | null;

let runtime: ElectronRuntime;

const executeAll = async (
  codeToEvaluate: string,
  connectionString: string,
  connectionOptions: MongoClientOptions
): Promise<[WorkerError, WorkerResult?]> => {
  try {
    // Instantiate a data service provider.
    //
    // TODO: update when `mongosh` will start to support cancellationToken.
    // See: https://github.com/mongodb/node-mongodb-native/commit/2014b7b/#diff-46fff96a6e12b2b0b904456571ce308fR132
    const serviceProvider: CliServiceProvider =
      await CliServiceProvider.connect(connectionString, connectionOptions);
    const outputLines: PlaygroundDebug = [];

    // Create a new instance of the runtime and evaluate code from a playground.
    if (!runtime) {
      runtime = new ElectronRuntime(serviceProvider);
    }

    runtime.setEvaluationListener({
      onPrint(values: EvaluationResult[]) {
        for (const { type, printable } of values) {
          outputLines.push({
            type,
            content: getContent({ type, printable }),
            namespace: null,
            language: null,
          });
        }
      },
    });
    const { source, type, printable } = await runtime.evaluate(codeToEvaluate);
    const namespace =
      source && source.namespace
        ? `${source.namespace.db}.${source.namespace.collection}`
        : null;
    const result: PlaygroundResult = {
      namespace,
      type: type ? type : typeof printable,
      content: getContent({ type, printable }),
      language: getLanguage({ type, printable }),
    };

    return [null, { outputLines, result }];
  } catch (error) {
    return [error];
  }
};

// eslint-disable-next-line complexity
const handleMessageFromParentPort = async ({
  name,
  data,
}: {
  name: string;
  data: any;
}): Promise<void> => {
  if (name === 'EXECUTE_NOTEBOOK') {
    parentPort?.postMessage(
      await executeAll(
        data.codeToEvaluate || workerData.codeToEvaluate,
        data.connectionString || workerData.connectionString,
        data.connectionOptions || workerData.connectionOptions
      )
    );
  }
};

// parentPort allows communication with the parent thread.
parentPort?.on('message', (message: any): void => {
  void handleMessageFromParentPort(message);
});