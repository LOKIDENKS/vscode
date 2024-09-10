import * as vscode from 'vscode';
import { beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import type { SinonSpy } from 'sinon';
import sinon from 'sinon';
import type { DataService } from 'mongodb-data-service';
import { ObjectId, Int32 } from 'bson';

import ParticipantController, {
  parseForDatabaseAndCollectionName,
  getRunnableContentFromString,
  QUERY_GENERATION_STATE,
} from '../../../participant/participant';
import ConnectionController from '../../../connectionController';
import { StorageController } from '../../../storage';
import { StatusView } from '../../../views';
import { ExtensionContextStub } from '../stubs';
import TelemetryService from '../../../telemetry/telemetryService';
import { TEST_DATABASE_URI } from '../dbTestHelper';
import { CHAT_PARTICIPANT_ID } from '../../../participant/constants';
import {
  SecretStorageLocation,
  StorageLocation,
} from '../../../storage/storageController';
import type { LoadedConnection } from '../../../storage/connectionStorage';

// The Copilot's model in not available in tests,
// therefore we need to mock its methods and returning values.
export const MAX_TOTAL_PROMPT_LENGTH = 16000;

const loadedConnection = {
  id: 'id',
  name: 'localhost',
  storageLocation: StorageLocation.NONE,
  secretStorageLocation: SecretStorageLocation.SecretStorage,
  connectionOptions: { connectionString: 'mongodb://localhost' },
};

suite('Participant Controller Test Suite', function () {
  const extensionContextStub = new ExtensionContextStub();

  // The test extension runner.
  extensionContextStub.extensionPath = '../../';

  let testConnectionController: ConnectionController;
  let testStorageController: StorageController;
  let testStatusView: StatusView;
  let testTelemetryService: TelemetryService;
  let testParticipantController: ParticipantController;
  let chatContextStub;
  let chatStreamStub;
  let chatTokenStub;
  let countTokensStub;
  let sendRequestStub;
  let telemetryTrackStub: SinonSpy;

  const sandbox = sinon.createSandbox();

  beforeEach(function () {
    testStorageController = new StorageController(extensionContextStub);
    testStatusView = new StatusView(extensionContextStub);

    telemetryTrackStub = sandbox.stub();

    testTelemetryService = new TelemetryService(
      testStorageController,
      extensionContextStub
    );
    testConnectionController = new ConnectionController({
      statusView: testStatusView,
      storageController: testStorageController,
      telemetryService: testTelemetryService,
    });
    testParticipantController = new ParticipantController({
      connectionController: testConnectionController,
      storageController: testStorageController,
      telemetryService: testTelemetryService,
    });
    chatContextStub = {
      history: [
        {
          participant: CHAT_PARTICIPANT_ID,
          prompt: 'hi',
          response: 'hello',
        },
      ],
    };
    chatStreamStub = {
      markdown: sinon.fake(),
      button: sinon.fake(),
    };
    chatTokenStub = {
      onCancellationRequested: sinon.fake(),
    };
    countTokensStub = sinon.stub();
    // The model returned by vscode.lm.selectChatModels is always undefined in tests.
    sendRequestStub = sinon.fake.resolves({
      text: [
        '```javascript\n' +
          "use('dbOne');\n" +
          "db.getCollection('collOne').find({ name: 'example' });\n" +
          '```',
      ],
    });
    sinon.replace(
      vscode.lm,
      'selectChatModels',
      sinon.fake.returns([
        {
          id: 'modelId',
          vendor: 'copilot',
          family: 'gpt-4o',
          version: 'gpt-4o-date',
          name: 'GPT 4o (date)',
          maxInputTokens: MAX_TOTAL_PROMPT_LENGTH,
          countTokens: countTokensStub,
          sendRequest: sendRequestStub,
        },
      ])
    );

    sinon.replace(testTelemetryService, 'track', telemetryTrackStub);
  });

  afterEach(function () {
    sinon.restore();
  });

  test('parses a returned by ai text for database and collection name', function () {
    const text = 'DATABASE_NAME: my  \nCOLLECTION_NAME: cats';
    const { databaseName, collectionName } =
      parseForDatabaseAndCollectionName(text);
    expect(databaseName).to.be.equal('my');
    expect(collectionName).to.be.equal('cats');
  });

  test('parses a returned by ai text for code blocks', function () {
    const text =
      '```javascript\n' +
      "use('test');\n" +
      "db.getCollection('test').find({ name: 'Shika' });\n" +
      '```';
    const code = getRunnableContentFromString(text);
    expect(code).to.be.equal(
      "use('test');\ndb.getCollection('test').find({ name: 'Shika' });"
    );
  });

  suite('when not connected', function () {
    let connectWithConnectionIdStub;
    let changeActiveConnectionStub;
    let getSavedConnectionsStub;

    beforeEach(function () {
      connectWithConnectionIdStub = sinon.stub(
        testParticipantController._connectionController,
        'connectWithConnectionId'
      );
      changeActiveConnectionStub = sinon.stub(
        testParticipantController._connectionController,
        'changeActiveConnection'
      );
      sinon.replace(
        testParticipantController._connectionController,
        'getActiveDataService',
        () => null
      );
      sinon.replace(
        testParticipantController._storageController,
        'get',
        sinon.fake.returns(true)
      );
      getSavedConnectionsStub = sinon.stub();
      sinon.replace(
        testParticipantController._connectionController,
        'getSavedConnections',
        getSavedConnectionsStub
      );
    });

    test('asks to connect', async function () {
      getSavedConnectionsStub.returns([loadedConnection]);
      const chatRequestMock = {
        prompt: 'find all docs by a name example',
        command: 'query',
        references: [],
      };
      await testParticipantController.chatHandler(
        chatRequestMock,
        chatContextStub,
        chatStreamStub,
        chatTokenStub
      );
      const connectMessage = chatStreamStub.markdown.getCall(0).args[0];
      expect(connectMessage).to.include(
        "Looks like you aren't currently connected, first let's get you connected to the cluster we'd like to create this query to run against."
      );
      const listConnectionsMessage = chatStreamStub.markdown.getCall(1).args[0];
      expect(listConnectionsMessage.value).to.include(
        '- <a href="command:mdb.connectWithParticipant?%5B%22id%22%5D">localhost</a>'
      );
      const showMoreMessage = chatStreamStub.markdown.getCall(2).args[0];
      expect(showMoreMessage.value).to.include(
        '- <a href="command:mdb.connectWithParticipant">Show more</a>'
      );
      expect(
        testParticipantController._chatResult?.metadata.responseContent
      ).to.be.eql(undefined);
      expect(testParticipantController._queryGenerationState).to.be.eql(
        QUERY_GENERATION_STATE.ASK_TO_CONNECT
      );
    });

    test('shows only 10 connections with the show more option', async function () {
      const connections: LoadedConnection[] = [];
      for (let i = 0; i < 11; i++) {
        connections.push({
          ...loadedConnection,
          id: `${loadedConnection.id}${i}`,
          name: `${loadedConnection.name}${i}`,
        });
      }
      getSavedConnectionsStub.returns(connections);
      const chatRequestMock = {
        prompt: 'find all docs by a name example',
        command: 'query',
        references: [],
      };
      await testParticipantController.chatHandler(
        chatRequestMock,
        chatContextStub,
        chatStreamStub,
        chatTokenStub
      );
      const connectMessage = chatStreamStub.markdown.getCall(0).args[0];
      expect(connectMessage).to.include(
        "Looks like you aren't currently connected, first let's get you connected to the cluster we'd like to create this query to run against."
      );
      const listConnectionsMessage = chatStreamStub.markdown.getCall(1).args[0];
      expect(listConnectionsMessage.value).to.include(
        '- <a href="command:mdb.connectWithParticipant?%5B%22id0%22%5D">localhost0</a>'
      );
      const showMoreMessage = chatStreamStub.markdown.getCall(11).args[0];
      expect(showMoreMessage.value).to.include(
        '- <a href="command:mdb.connectWithParticipant">Show more</a>'
      );
      expect(chatStreamStub.markdown.callCount).to.be.eql(12);
      expect(
        testParticipantController._chatResult?.metadata.responseContent
      ).to.be.eql(undefined);
      expect(testParticipantController._queryGenerationState).to.be.eql(
        QUERY_GENERATION_STATE.ASK_TO_CONNECT
      );
    });

    test('handles empty connection name', async function () {
      getSavedConnectionsStub.returns([loadedConnection]);
      const chatRequestMock = {
        prompt: 'find all docs by a name example',
        command: 'query',
        references: [],
      };
      await testParticipantController.chatHandler(
        chatRequestMock,
        chatContextStub,
        chatStreamStub,
        chatTokenStub
      );
      expect(testParticipantController._queryGenerationState).to.be.eql(
        QUERY_GENERATION_STATE.ASK_TO_CONNECT
      );

      chatRequestMock.prompt = '';
      await testParticipantController.chatHandler(
        chatRequestMock,
        chatContextStub,
        chatStreamStub,
        chatTokenStub
      );

      const emptyMessage = chatStreamStub.markdown.getCall(3).args[0];
      expect(emptyMessage).to.include(
        'Please select a cluster to connect by clicking on an item in the connections list.'
      );
      const listConnectionsMessage = chatStreamStub.markdown.getCall(4).args[0];
      expect(listConnectionsMessage.value).to.include(
        '- <a href="command:mdb.connectWithParticipant?%5B%22id%22%5D">localhost</a>'
      );
      const showMoreMessage = chatStreamStub.markdown.getCall(5).args[0];
      expect(showMoreMessage.value).to.include(
        '- <a href="command:mdb.connectWithParticipant">Show more</a>'
      );
      expect(
        testParticipantController._chatResult?.metadata.responseContent
      ).to.be.eql(undefined);
      expect(testParticipantController._queryGenerationState).to.be.eql(
        QUERY_GENERATION_STATE.ASK_TO_CONNECT
      );
    });

    test('calls connect by id for an existing connection', async function () {
      await testParticipantController.connectWithParticipant('123');
      expect(connectWithConnectionIdStub).to.have.been.calledWithExactly('123');
    });

    test('calls connect with uri for a new connection', async function () {
      await testParticipantController.connectWithParticipant();
      expect(changeActiveConnectionStub).to.have.been.called;
    });
  });

  suite('when connected', function () {
    let sampleStub;

    beforeEach(function () {
      sampleStub = sinon.stub();
      sinon.replace(
        testParticipantController._connectionController,
        'getActiveDataService',
        () =>
          ({
            listDatabases: () =>
              Promise.resolve([
                { name: 'dbOne' },
                { name: 'customer' },
                { name: 'inventory' },
                { name: 'sales' },
                { name: 'employee' },
                { name: 'financialReports' },
                { name: 'productCatalog' },
                { name: 'projectTracker' },
                { name: 'user' },
                { name: 'analytics' },
                { name: '123' },
              ]),
            listCollections: () =>
              Promise.resolve([
                { name: 'collOne' },
                { name: 'notifications' },
                { name: 'products' },
                { name: 'orders' },
                { name: 'categories' },
                { name: 'invoices' },
                { name: 'transactions' },
                { name: 'logs' },
                { name: 'messages' },
                { name: 'sessions' },
                { name: 'feedback' },
              ]),
            getMongoClientConnectionOptions: () => ({
              url: TEST_DATABASE_URI,
              options: {},
            }),
            sample: sampleStub,
            once: sinon.stub(),
          } as unknown as DataService)
      );
      sinon
        .stub(testParticipantController, '_shouldAskToConnectIfNotConnected')
        .returns(false);
    });

    suite('when has not been shown a welcome message yet', function () {
      beforeEach(function () {
        sinon.replace(
          testParticipantController._storageController,
          'get',
          sinon.fake.returns(false)
        );
      });

      test('prints a welcome message to chat', async function () {
        const chatRequestMock = {
          prompt: 'find all docs by a name example',
          command: 'query',
          references: [],
        };
        await testParticipantController.chatHandler(
          chatRequestMock,
          chatContextStub,
          chatStreamStub,
          chatTokenStub
        );
        const welcomeMessage = chatStreamStub.markdown.firstCall.args[0];
        expect(welcomeMessage).to.include('Welcome to MongoDB Participant!');
      });
    });

    suite('when has been shown a welcome message already', function () {
      beforeEach(function () {
        sinon.replace(
          testParticipantController._storageController,
          'get',
          sinon.fake.returns(true)
        );
      });

      suite('generic command', function () {
        test('generates a query', async function () {
          const chatRequestMock = {
            prompt: 'how to find documents in my collection?',
            command: undefined,
            references: [],
          };
          expect(testParticipantController._queryGenerationState).to.be.equal(
            undefined
          );
          expect(testParticipantController._chatResult).to.be.equal(undefined);
          await testParticipantController.chatHandler(
            chatRequestMock,
            chatContextStub,
            chatStreamStub,
            chatTokenStub
          );
          expect(
            testParticipantController._chatResult?.metadata.responseContent
          ).to.include(
            "db.getCollection('collOne').find({ name: 'example' });"
          );
        });
      });

      suite('query command', function () {
        suite('known namespace', function () {
          beforeEach(function () {
            sinon
              .stub(testParticipantController, '_databaseName')
              .value('dbOne');
            sinon
              .stub(testParticipantController, '_collectionName')
              .value('collOne');
            sinon
              .stub(testParticipantController, '_shouldAskForNamespace')
              .resolves(false);
          });

          test('generates a query', async function () {
            const chatRequestMock = {
              prompt: 'find all docs by a name example',
              command: 'query',
              references: [],
            };
            expect(testParticipantController._queryGenerationState).to.be.equal(
              undefined
            );
            expect(testParticipantController._chatResult).to.be.equal(
              undefined
            );
            await testParticipantController.chatHandler(
              chatRequestMock,
              chatContextStub,
              chatStreamStub,
              chatTokenStub
            );
            expect(
              testParticipantController._chatResult?.metadata.responseContent
            ).to.include(
              "db.getCollection('collOne').find({ name: 'example' });"
            );
          });

          test('includes a collection schema', async function () {
            sinon
              .stub(testParticipantController, '_queryGenerationState')
              .value(QUERY_GENERATION_STATE.FETCH_SCHEMA);
            sampleStub.resolves([
              {
                _id: new ObjectId('63ed1d522d8573fa5c203660'),
                field: {
                  stringField:
                    'There was a house cat who finally got the chance to do what it had always wanted to do.',
                  arrayField: [new Int32('1')],
                },
              },
            ]);
            const chatRequestMock = {
              prompt: 'find all docs by a name example',
              command: 'query',
              references: [],
            };
            await testParticipantController.chatHandler(
              chatRequestMock,
              chatContextStub,
              chatStreamStub,
              chatTokenStub
            );
            const messages = sendRequestStub.firstCall.args[0];
            expect(messages[0].content).to.include(
              'Collection schema: _id: ObjectId\n' +
                'field.stringField: String\n' +
                'field.arrayField: Array<Int32>\n'
            );
          });

          suite('useSampleDocsInCopilot setting is true', function () {
            beforeEach(async () => {
              await vscode.workspace
                .getConfiguration('mdb')
                .update('useSampleDocsInCopilot', true);
            });

            afterEach(async () => {
              await vscode.workspace
                .getConfiguration('mdb')
                .update('useSampleDocsInCopilot', false);
            });

            test('includes 3 sample documents as an array', async function () {
              sinon
                .stub(testParticipantController, '_queryGenerationState')
                .value(QUERY_GENERATION_STATE.FETCH_SCHEMA);
              countTokensStub.resolves(MAX_TOTAL_PROMPT_LENGTH);
              sampleStub.resolves([
                {
                  _id: new ObjectId('63ed1d522d8573fa5c203661'),
                  field: {
                    stringField: 'Text 1',
                  },
                },
                {
                  _id: new ObjectId('63ed1d522d8573fa5c203662'),
                  field: {
                    stringField: 'Text 2',
                  },
                },
                {
                  _id: new ObjectId('63ed1d522d8573fa5c203663'),
                  field: {
                    stringField: 'Text 3',
                  },
                },
              ]);
              const chatRequestMock = {
                prompt: 'find all docs by a name example',
                command: 'query',
                references: [],
              };
              await testParticipantController.chatHandler(
                chatRequestMock,
                chatContextStub,
                chatStreamStub,
                chatTokenStub
              );
              const messages = sendRequestStub.firstCall.args[0];
              expect(messages[0].content).to.include(
                'Sample documents: [\n' +
                  '  {\n' +
                  "    _id: ObjectId('63ed1d522d8573fa5c203661'),\n" +
                  '    field: {\n' +
                  "      stringField: 'Text 1'\n" +
                  '    }\n' +
                  '  },\n' +
                  '  {\n' +
                  "    _id: ObjectId('63ed1d522d8573fa5c203662'),\n" +
                  '    field: {\n' +
                  "      stringField: 'Text 2'\n" +
                  '    }\n' +
                  '  },\n' +
                  '  {\n' +
                  "    _id: ObjectId('63ed1d522d8573fa5c203663'),\n" +
                  '    field: {\n' +
                  "      stringField: 'Text 3'\n" +
                  '    }\n' +
                  '  }\n' +
                  ']\n'
              );
            });

            test('includes 1 sample document as an object', async function () {
              sinon
                .stub(testParticipantController, '_queryGenerationState')
                .value(QUERY_GENERATION_STATE.FETCH_SCHEMA);
              countTokensStub.resolves(MAX_TOTAL_PROMPT_LENGTH);
              sampleStub.resolves([
                {
                  _id: new ObjectId('63ed1d522d8573fa5c203660'),
                  field: {
                    stringField:
                      'There was a house cat who finally got the chance to do what it had always wanted to do.',
                    arrayField: [
                      new Int32('1'),
                      new Int32('2'),
                      new Int32('3'),
                      new Int32('4'),
                      new Int32('5'),
                      new Int32('6'),
                      new Int32('7'),
                      new Int32('8'),
                      new Int32('9'),
                    ],
                  },
                },
              ]);
              const chatRequestMock = {
                prompt: 'find all docs by a name example',
                command: 'query',
                references: [],
              };
              await testParticipantController.chatHandler(
                chatRequestMock,
                chatContextStub,
                chatStreamStub,
                chatTokenStub
              );
              const messages = sendRequestStub.firstCall.args[0];
              expect(messages[0].content).to.include(
                'Sample document: {\n' +
                  "  _id: ObjectId('63ed1d522d8573fa5c203660'),\n" +
                  '  field: {\n' +
                  "    stringField: 'There was a house ca',\n" +
                  '    arrayField: [\n' +
                  "      NumberInt('1'),\n" +
                  "      NumberInt('2'),\n" +
                  "      NumberInt('3')\n" +
                  '    ]\n' +
                  '  }\n' +
                  '}\n'
              );
            });

            test('includes 1 sample documents when 3 make prompt too long', async function () {
              sinon
                .stub(testParticipantController, '_queryGenerationState')
                .value(QUERY_GENERATION_STATE.FETCH_SCHEMA);
              countTokensStub.onCall(0).resolves(MAX_TOTAL_PROMPT_LENGTH + 1);
              countTokensStub.onCall(1).resolves(MAX_TOTAL_PROMPT_LENGTH);
              sampleStub.resolves([
                {
                  _id: new ObjectId('63ed1d522d8573fa5c203661'),
                  field: {
                    stringField: 'Text 1',
                  },
                },
                {
                  _id: new ObjectId('63ed1d522d8573fa5c203662'),
                  field: {
                    stringField: 'Text 2',
                  },
                },
                {
                  _id: new ObjectId('63ed1d522d8573fa5c203663'),
                  field: {
                    stringField: 'Text 3',
                  },
                },
              ]);
              const chatRequestMock = {
                prompt: 'find all docs by a name example',
                command: 'query',
                references: [],
              };
              await testParticipantController.chatHandler(
                chatRequestMock,
                chatContextStub,
                chatStreamStub,
                chatTokenStub
              );
              const messages = sendRequestStub.firstCall.args[0];
              expect(messages[0].content).to.include(
                'Sample document: {\n' +
                  "  _id: ObjectId('63ed1d522d8573fa5c203661'),\n" +
                  '  field: {\n' +
                  "    stringField: 'Text 1'\n" +
                  '  }\n' +
                  '}\n'
              );
            });

            test('does not include sample documents when even 1 makes prompt too long', async function () {
              sinon
                .stub(testParticipantController, '_queryGenerationState')
                .value(QUERY_GENERATION_STATE.FETCH_SCHEMA);
              countTokensStub.onCall(0).resolves(MAX_TOTAL_PROMPT_LENGTH + 1);
              countTokensStub.onCall(1).resolves(MAX_TOTAL_PROMPT_LENGTH + 1);
              sampleStub.resolves([
                {
                  _id: new ObjectId('63ed1d522d8573fa5c203661'),
                  field: {
                    stringField: 'Text 1',
                  },
                },
                {
                  _id: new ObjectId('63ed1d522d8573fa5c203662'),
                  field: {
                    stringField: 'Text 2',
                  },
                },
                {
                  _id: new ObjectId('63ed1d522d8573fa5c203663'),
                  field: {
                    stringField: 'Text 3',
                  },
                },
              ]);
              const chatRequestMock = {
                prompt: 'find all docs by a name example',
                command: 'query',
                references: [],
              };
              await testParticipantController.chatHandler(
                chatRequestMock,
                chatContextStub,
                chatStreamStub,
                chatTokenStub
              );
              const messages = sendRequestStub.firstCall.args[0];
              expect(messages[0].content).to.not.include('Sample documents');
            });
          });

          suite('useSampleDocsInCopilot setting is false', function () {
            test('does not include sample documents', async function () {
              sinon
                .stub(testParticipantController, '_queryGenerationState')
                .value(QUERY_GENERATION_STATE.FETCH_SCHEMA);
              const chatRequestMock = {
                prompt: 'find all docs by a name example',
                command: 'query',
                references: [],
              };
              await testParticipantController.chatHandler(
                chatRequestMock,
                chatContextStub,
                chatStreamStub,
                chatTokenStub
              );
              const messages = sendRequestStub.firstCall.args[0];
              expect(messages[0].content).to.not.include('Sample documents');
            });
          });
        });

        suite('unknown namespace', function () {
          test('asks for a namespace and generates a query', async function () {
            const chatRequestMock = {
              prompt: 'find all docs by a name example',
              command: 'query',
              references: [],
            };
            expect(testParticipantController._queryGenerationState).to.be.equal(
              undefined
            );
            await testParticipantController.chatHandler(
              chatRequestMock,
              chatContextStub,
              chatStreamStub,
              chatTokenStub
            );
            const askForDBMessage = chatStreamStub.markdown.getCall(0).args[0];
            expect(askForDBMessage).to.include(
              'What is the name of the database you would like this query to run against?'
            );
            const listDBsMessage = chatStreamStub.markdown.getCall(1).args[0];
            expect(listDBsMessage.value).to.include(
              '- <a href="command:mdb.selectDatabaseWithParticipant?%5B%22dbOne%22%5D">dbOne</a>'
            );
            const showMoreDBsMessage =
              chatStreamStub.markdown.getCall(11).args[0];
            expect(showMoreDBsMessage.value).to.include(
              '- <a href="command:mdb.selectDatabaseWithParticipant">Show more</a>'
            );
            expect(chatStreamStub.markdown.callCount).to.be.eql(12);
            expect(
              testParticipantController._chatResult?.metadata.responseContent
            ).to.be.eql(undefined);
            expect(testParticipantController._queryGenerationState).to.be.eql(
              QUERY_GENERATION_STATE.ASK_FOR_DATABASE_NAME
            );

            chatRequestMock.prompt = 'dbOne';
            await testParticipantController.chatHandler(
              chatRequestMock,
              chatContextStub,
              chatStreamStub,
              chatTokenStub
            );

            expect(testParticipantController._databaseName).to.be.equal(
              'dbOne'
            );
            const askForCollMessage =
              chatStreamStub.markdown.getCall(12).args[0];
            expect(askForCollMessage).to.include(
              'Which collection would you like to query within this database?'
            );
            const listCollsMessage =
              chatStreamStub.markdown.getCall(13).args[0];
            expect(listCollsMessage.value).to.include(
              '- <a href="command:mdb.selectCollectionWithParticipant?%5B%22collOne%22%5D">collOne</a>'
            );
            const showMoreCollsMessage =
              chatStreamStub.markdown.getCall(23).args[0];
            expect(showMoreCollsMessage.value).to.include(
              '- <a href="command:mdb.selectCollectionWithParticipant">Show more</a>'
            );
            expect(chatStreamStub.markdown.callCount).to.be.eql(24);
            expect(
              testParticipantController._chatResult?.metadata.responseContent
            ).to.be.eql(undefined);
            expect(testParticipantController._queryGenerationState).to.be.eql(
              QUERY_GENERATION_STATE.ASK_FOR_COLLECTION_NAME
            );

            chatRequestMock.prompt = 'collOne';
            await testParticipantController.chatHandler(
              chatRequestMock,
              chatContextStub,
              chatStreamStub,
              chatTokenStub
            );

            expect(testParticipantController._collectionName).to.be.equal(
              'collOne'
            );
            expect(
              testParticipantController._chatResult?.metadata.responseContent
            ).to.include(
              "db.getCollection('collOne').find({ name: 'example' });"
            );
          });

          test('handles empty database name', async function () {
            sinon
              .stub(testParticipantController, '_queryGenerationState')
              .value(QUERY_GENERATION_STATE.ASK_FOR_DATABASE_NAME);

            const chatRequestMock = {
              prompt: '',
              command: 'query',
              references: [],
            };
            await testParticipantController.chatHandler(
              chatRequestMock,
              chatContextStub,
              chatStreamStub,
              chatTokenStub
            );

            const emptyMessage = chatStreamStub.markdown.getCall(0).args[0];
            expect(emptyMessage).to.include(
              'Please select a database by either clicking on an item in the list or typing the name manually in the chat.'
            );
            const listDBsMessage = chatStreamStub.markdown.getCall(1).args[0];
            expect(listDBsMessage.value).to.include(
              '- <a href="command:mdb.selectDatabaseWithParticipant?%5B%22dbOne%22%5D">dbOne</a>'
            );
            expect(testParticipantController._queryGenerationState).to.be.eql(
              QUERY_GENERATION_STATE.ASK_FOR_DATABASE_NAME
            );
          });

          test('handles empty collection name', async function () {
            sinon
              .stub(testParticipantController, '_queryGenerationState')
              .value(QUERY_GENERATION_STATE.ASK_FOR_COLLECTION_NAME);
            sinon
              .stub(testParticipantController, '_databaseName')
              .value('dbOne');

            const chatRequestMock = {
              prompt: '',
              command: 'query',
              references: [],
            };
            await testParticipantController.chatHandler(
              chatRequestMock,
              chatContextStub,
              chatStreamStub,
              chatTokenStub
            );

            const emptyMessage = chatStreamStub.markdown.getCall(0).args[0];
            expect(emptyMessage).to.include(
              'Please select a collection by either clicking on an item in the list or typing the name manually in the chat.'
            );
            const listCollsMessage = chatStreamStub.markdown.getCall(1).args[0];
            expect(listCollsMessage.value).to.include(
              '- <a href="command:mdb.selectCollectionWithParticipant?%5B%22collOne%22%5D">collOne</a>'
            );
            expect(testParticipantController._queryGenerationState).to.be.eql(
              QUERY_GENERATION_STATE.ASK_FOR_COLLECTION_NAME
            );
          });
        });
      });
    });
  });

  suite('telemetry', function () {
    test('reports positive user feedback', function () {
      testParticipantController.handleUserFeedback({
        kind: vscode.ChatResultFeedbackKind.Helpful,
        result: {
          metadata: {
            responseType: 'connections',
            responseContent: '```creditCardNumber: 1234-5678-9012-3456```',
          },
        },
      });

      sinon.assert.calledOnce(telemetryTrackStub);
      expect(telemetryTrackStub.lastCall.args[0]).to.be.equal(
        'Participant Feedback'
      );

      const properties = telemetryTrackStub.lastCall.args[1];
      expect(properties.feedback).to.be.equal('positive');
      expect(properties.reason).to.be.undefined;
      expect(properties.response_type).to.be.equal('connections');

      // Ensure we're not leaking the response content into the telemetry payload
      expect(JSON.stringify(properties))
        .to.not.include('creditCardNumber')
        .and.not.include('1234-5678-9012-3456');
    });

    test('reports negative user feedback', function () {
      testParticipantController.handleUserFeedback({
        kind: vscode.ChatResultFeedbackKind.Unhelpful,
        result: {
          metadata: {
            responseType: 'query',
            responseContent: 'SSN: 123456789',
          },
        },
        unhelpfulReason: 'incompleteCode',
      });

      sinon.assert.calledOnce(telemetryTrackStub);
      expect(telemetryTrackStub.lastCall.args[0]).to.be.equal(
        'Participant Feedback'
      );

      const properties = telemetryTrackStub.lastCall.args[1];
      expect(properties.feedback).to.be.equal('negative');
      expect(properties.reason).to.be.equal('incompleteCode');
      expect(properties.response_type).to.be.equal('query');

      // Ensure we're not leaking the response content into the telemetry payload
      expect(JSON.stringify(properties))
        .to.not.include('SSN')
        .and.not.include('123456789');
    });
  });
});