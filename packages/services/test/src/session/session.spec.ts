// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import expect = require('expect.js');

import {
  PageConfig, uuid
} from '@jupyterlab/coreutils';

import {
  toArray
} from '@phosphor/algorithm';

import {
  KernelMessage
} from '../../../lib/kernel';

import {
  Session
} from '../../../lib/session';

import {
  serverSettings, expectFailure, KernelTester
} from '../utils';


/**
 * Create a unique session id.
 */
function createSessionModel(id?: string): Session.IModel {
  return {
    id: id || uuid(),
    path: uuid(),
    name: '',
    type: '',
    kernel: { id: uuid(), name: uuid() }
  };
}


/**
 * Create session options based on a sessionModel.
 */
function createSessionOptions(sessionModel?: Session.IModel): Session.IOptions {
  sessionModel = sessionModel || createSessionModel();
  return {
    path: sessionModel.path,
    kernelName: sessionModel.kernel.name
  };
}


describe('session', () => {

  let tester: KernelTester;
  let session: Session.ISession;

  beforeEach(() => {
    tester = new KernelTester();
  });

  afterEach(() => {
    if (session) {
      session.dispose();
    }
    tester.dispose();
  });

  describe('Session.listRunning()', () => {

    it('should yield a list of valid session models', (done) => {
      let sessionModels = [createSessionModel(), createSessionModel()];
      tester.runningSessions = sessionModels;
      let list = Session.listRunning();
      list.then(response => {
        let running = toArray(response);
        expect(running[0]).to.eql(sessionModels[0]);
        expect(running[1]).to.eql(sessionModels[1]);
        done();
      });
    });

    it('should accept ajax options', (done) => {
      let sessionModels = [createSessionModel(), createSessionModel()];
      tester.runningSessions = sessionModels;
      let list = Session.listRunning(serverSettings);
      list.then(response => {
        let running = toArray(response);
        expect(running[0]).to.eql(sessionModels[0]);
        expect(running[1]).to.eql(sessionModels[1]);
        done();
      });
    });

    it('should throw an error for an invalid model', (done) => {
      let data = { id: '1234', path: 'test' };
      tester.onRequest = () => {
        tester.respond(200, data);
      };
      let list = Session.listRunning();
      expectFailure(list, done);
    });

    it('should throw an error for another invalid model', (done) => {
      let data = [{ id: '1234', kernel: { id: '', name: '' }, path: '' }];
      tester.onRequest = () => {
        tester.respond(200, data);
      };
      let list = Session.listRunning();
      expectFailure(list, done);
    });

    it('should fail for wrong response status', (done) => {
      tester.onRequest = () => {
        tester.respond(201, [createSessionModel()]);
      };
      let list = Session.listRunning();
      expectFailure(list, done);
    });

    it('should fail for error response status', (done) => {
      tester.onRequest = () => {
        tester.respond(500, { });
      };
      let list = Session.listRunning();
      expectFailure(list, done, '');
    });

    it('should update an existing session', (done) => {
      let newKernel = { name: 'fizz', id: 'buzz' };
      Session.startNew({ path: 'foo' }).then(s => {
        session = s;
        tester.onRequest = request => {
          tester.respond(200, [ {
            id: session.model.id,
            path: 'foo/bar.ipynb',
            name: '',
            type: '',
            kernel: newKernel
          } ]);
          tester.onRequest = () => {
            tester.respond(200, newKernel);
          };
        };
        session.kernelChanged.connect((value, kernel) => {
          expect(kernel.name).to.be(newKernel.name);
          expect(kernel.id).to.be(newKernel.id);
          expect(value.path).to.be('foo/bar.ipynb');
          value.dispose();
          done();
        });
        Session.listRunning();
      });
    });

  });

  describe('Session.startNew', () => {

    it('should start a session', (done) => {
      Session.startNew({ path: 'foo' }).then(s => {
        session = s;
        expect(session.id).to.be.ok();
        done();
      });
    });

    it('should accept ajax options', (done) => {
      let options: Session.IOptions = { path: 'foo', serverSettings };
      Session.startNew(options).then(s => {
        session = s;
        expect(session.id).to.ok();
        done();
      });
    });

    it('should start even if the websocket fails', (done) => {
      tester.initialStatus = 'dead';
      Session.startNew({ path: 'foo' }).then(s => {
        session = s;
        done();
      });
    });

    it('should fail for wrong response status', (done) => {
      let sessionModel = createSessionModel();
      tester.onRequest = () => {
        tester.respond(200, sessionModel);
      };
      let options = createSessionOptions(sessionModel);
      let sessionPromise = Session.startNew(options);
      expectFailure(sessionPromise, done);
    });

    it('should fail for error response status', (done) => {
      tester.onRequest = () => {
        tester.respond(500, {});
      };
      let sessionModel = createSessionModel();
      let options = createSessionOptions(sessionModel);
      let sessionPromise = Session.startNew(options);
      expectFailure(sessionPromise, done, '');
    });

    it('should fail for wrong response model', (done) => {
      let sessionModel = createSessionModel();
      let data = {
        id: 1, kernel: { name: '', id: '' }, path: '', type: '', name: ''
      };
      tester.onRequest = request => {
        if (request.method === 'POST') {
          tester.respond(201, sessionModel);
        } else {
          tester.respond(200, data);
        }
      };
      let options = createSessionOptions(sessionModel);
      let sessionPromise = Session.startNew(options);
      let msg = `Session failed to start: No running kernel with id: ${sessionModel.kernel.id}`;
      expectFailure(sessionPromise, done, msg);
    });

    it('should fail if the kernel is not running', (done) => {
      let sessionModel = createSessionModel();
      tester.onRequest = request => {
        if (request.method === 'POST') {
          tester.respond(201, sessionModel);
        } else {
          tester.respond(400, {});
        }
      };
      let options = createSessionOptions(sessionModel);
      let sessionPromise = Session.startNew(options);
      expectFailure(sessionPromise, done, 'Session failed to start');
    });
  });

  describe('Session.findByPath()', () => {

    it('should find an existing session by path', (done) => {
      let sessionModel = createSessionModel();
      tester.runningSessions = [sessionModel];
      Session.findByPath(sessionModel.path).then(newId => {
        expect(newId.path).to.be(sessionModel.path);
        done();
      }).catch(done);
    });

  });

  describe('Session.findById()', () => {

    it('should find an existing session by id', (done) => {
      let sessionModel = createSessionModel();
      tester.runningSessions = [sessionModel];
      Session.findById(sessionModel.id).then(newId => {
        expect(newId.id).to.be(sessionModel.id);
        done();
      }).catch(done);
    });

  });

  describe('Session.connectTo()', () => {

    it('should connect to a running session', (done) => {
      Session.startNew({ path: 'foo' }).then(s => {
        session = s;
        Session.connectTo(session.id).then((newSession) => {
          expect(newSession.id).to.be(session.id);
          expect(newSession.kernel.id).to.be(session.kernel.id);
          expect(newSession).to.not.be(session);
          expect(newSession.kernel).to.not.be(session.kernel);
          newSession.dispose();
          done();
        }).catch(done);
      });
    });

    it('should connect to a client session if available', (done) => {
      let sessionModel = createSessionModel();
      tester.runningSessions = [sessionModel];
      Session.connectTo(sessionModel.id, serverSettings).then(s => {
        session = s;
        expect(session.id).to.be(sessionModel.id);
        done();
      }).catch(done);
    });

    it('should accept server settings', (done) => {
      let sessionModel = createSessionModel();
      tester.runningSessions = [sessionModel];
      Session.connectTo(sessionModel.id, serverSettings).then(s => {
        session = s;
        expect(session.id).to.be.ok();
        done();
      }).catch(done);
    });

    it('should fail if session is not available', (done) => {
      tester.onRequest = () => {
        tester.respond(500, {});
      };
      let sessionModel = createSessionModel();
      let sessionPromise = Session.connectTo(sessionModel.id, serverSettings);
      expectFailure(
        sessionPromise, done, 'No running session with id: ' + sessionModel.id
      );
    });
  });

  describe('Session.shutdown()', () => {

    it('should shut down a kernel by id', (done) => {
      Session.shutdown('foo').then(done, done);
    });

    it('should handle a 404 status', (done) => {
      tester.onRequest = () => {
        tester.respond(404, { });
      };
      Session.shutdown('foo').then(done, done);
    });

  });


  describe('Session.ISession', () => {


    beforeEach((done) => {
      Session.startNew({ path: 'foo' }).then(s => {
        session = s;
        done();
      }).catch(done);
    });

    afterEach(() => {
      session.dispose();
    });

    context('#terminated', () => {

      it('should emit when the session is shut down', (done) => {
        session.terminated.connect(() => {
          done();
        });
        session.shutdown();
      });
    });

    context('#kernelChanged', () => {

      it('should emit when the kernel changes', (done) => {
        let model = createSessionModel(session.id);
        let name = model.kernel.name;
        let id = model.kernel.id;
        tester.onRequest = request => {
          if (request.method === 'PATCH') {
            tester.respond(200, model);
          } else {
            tester.respond(200, { name, id });
          }
        };
        session.changeKernel({ name });
        session.kernelChanged.connect((s, kernel) => {
          expect(kernel.name).to.be(name);
          done();
        });
      });

    });

    context('#statusChanged', () => {

      it('should emit when the kernel status changes', (done) => {
        session.statusChanged.connect((s, status) => {
          if (status === 'busy') {
            done();
          }
        });
        session.kernel.requestKernelInfo().then(() => {
          tester.sendStatus('busy');
        }).catch(done);
      });
    });

    context('#iopubMessage', () => {

      it('should be emitted for an iopub message', (done) => {
        session.iopubMessage.connect((s, msg) => {
          expect(msg.header.msg_type).to.be('status');
          done();
        });
        let msg = KernelMessage.createMessage({
          msgType: 'status',
          channel: 'iopub',
          session: ''
        }) as KernelMessage.IStatusMsg;
        msg.content.execution_state = 'idle';
        msg.parent_header = msg.header;
        tester.send(msg);
      });
    });

    context('#unhandledMessage', () => {

      it('should be emitted for an unhandled message', (done) => {
        session.unhandledMessage.connect((s, msg) => {
          expect(msg.header.msg_type).to.be('foo');
          done();
        });
        let msg = KernelMessage.createMessage({
          msgType: 'foo',
          channel: 'shell',
          session: session.kernel.clientId
        });
        msg.parent_header = msg.header;
        tester.send(msg);
      });
    });

    context('#propertyChanged', () => {

      it('should be emitted when the session path changes', () => {
        // TODO: reinstate after switching to mock-socket
        // let model = createSessionModel(session.id);
        // tester.onRequest = () => {
        //   tester.respond(200, model);
        // };
        // session.pathChanged.connect((s, path) => {
        //   // expect(session.path).to.be(model.path);
        //   // expect(path).to.be(model.path);
        //   done();
        // });
        // session.rename(model.path);
      });

    });

    context('#id', () => {

      it('should be a string', () => {
        expect(typeof session.id).to.be('string');
      });
    });

    context('#path', () => {

      it('should be a string', () => {
        expect(typeof session.path).to.be('string');
      });
    });

    context('#name', () => {

      it('should be a string', () => {
        expect(typeof session.name).to.be('string');
      });
    });

    context('#type', () => {

      it('should be a string', () => {
        expect(typeof session.name).to.be('string');
      });
    });

    context('#model', () => {

      it('should be an IModel', () => {
        let model = session.model;
        expect(typeof model.id).to.be('string');
        expect(typeof model.path).to.be('string');
        expect(typeof model.kernel.name).to.be('string');
        expect(typeof model.kernel.id).to.be('string');
      });

    });

    context('#kernel', () => {

      it('should be an IKernel object', () => {
        expect(typeof session.kernel.id).to.be('string');
      });

    });

    context('#kernel', () => {

      it('should be a delegate to the kernel status', () => {
        expect(session.status).to.be(session.kernel.status);
      });
    });

    context('#serverSettings', () => {

      it('should be the serverSettings', () => {
        expect(session.serverSettings.baseUrl).to.be(PageConfig.getBaseUrl());
      });

    });

    context('#isDisposed', () => {

      it('should be true after we dispose of the session', () => {
        expect(session.isDisposed).to.be(false);
        session.dispose();
        expect(session.isDisposed).to.be(true);
      });

      it('should be safe to call multiple times', () => {
        expect(session.isDisposed).to.be(false);
        expect(session.isDisposed).to.be(false);
        session.dispose();
        expect(session.isDisposed).to.be(true);
        expect(session.isDisposed).to.be(true);
      });
    });

    context('#dispose()', () => {

      it('should dispose of the resources held by the session', () => {
        session.dispose();
        expect(session.isDisposed).to.be(true);
      });

      it('should be safe to call twice', () => {
        session.dispose();
        expect(session.isDisposed).to.be(true);
        session.dispose();
        expect(session.isDisposed).to.be(true);
      });

      it('should be safe to call if the kernel is disposed', () => {
        session.kernel.dispose();
        session.dispose();
        expect(session.isDisposed).to.be(true);
      });

    });

    context('#setPath()', () => {

      it('should set the path of the session', () => {
        let model = { ...session.model, path: 'foo.ipynb' };
        tester.onRequest = () => {
          tester.respond(200, model);
        };
        return session.setPath(model.path).then(() => {
          expect(session.path).to.be(model.path);
          session.dispose();
        });
      });

      it('should fail for improper response status', (done) => {
        let promise = session.setPath('foo');
        tester.onRequest = () => {
          tester.respond(201, { });
          expectFailure(promise, done);
        };
      });

      it('should fail for error response status', (done) => {
        let promise = session.setPath('foo');
        tester.onRequest = () => {
          tester.respond(500, { });
          expectFailure(promise, done, '');
        };
      });

      it('should fail for improper model', (done) => {
        let promise = session.setPath('foo');
        tester.onRequest = () => {
          tester.respond(200, { });
          expectFailure(promise, done);
        };
      });

      it('should fail if the session is disposed', (done) => {
        session.dispose();
        let promise = session.setPath('foo');
        expectFailure(promise, done, 'Session is disposed');
      });

    });

    context('#setType()', () => {

      it('should set the type of the session', () => {
        let model = { ...session.model, type: 'foo' };
        tester.onRequest = () => {
          tester.respond(200, model);
        };
        return session.setType(model.type).then(() => {
          expect(session.type).to.be(model.type);
          session.dispose();
        });
      });

      it('should fail for improper response status', (done) => {
        let promise = session.setType('foo');
        tester.onRequest = () => {
          tester.respond(201, { });
          expectFailure(promise, done);
        };
      });

      it('should fail for error response status', (done) => {
        let promise = session.setType('foo');
        tester.onRequest = () => {
          tester.respond(500, { });
          expectFailure(promise, done, '');
        };
      });

      it('should fail for improper model', (done) => {
        let promise = session.setType('foo');
        tester.onRequest = () => {
          tester.respond(200, { });
          expectFailure(promise, done);
        };
      });

      it('should fail if the session is disposed', (done) => {
        session.dispose();
        let promise = session.setPath('foo');
        expectFailure(promise, done, 'Session is disposed');
      });

    });

    context('#setName()', () => {

      it('should set the name of the session', () => {
        let model = { ...session.model, name: 'foo' };
        tester.onRequest = () => {
          tester.respond(200, model);
        };
        return session.setName(model.name).then(() => {
          expect(session.name).to.be(model.name);
          session.dispose();
        });
      });

      it('should fail for improper response status', (done) => {
        let promise = session.setName('foo');
        tester.onRequest = () => {
          tester.respond(201, { });
          expectFailure(promise, done);
        };
      });

      it('should fail for error response status', (done) => {
        let promise = session.setName('foo');
        tester.onRequest = () => {
          tester.respond(500, { });
          expectFailure(promise, done, '');
        };
      });

      it('should fail for improper model', (done) => {
        let promise = session.setName('foo');
        tester.onRequest = () => {
          tester.respond(200, { });
          expectFailure(promise, done);
        };
      });

      it('should fail if the session is disposed', (done) => {
        session.dispose();
        let promise = session.setPath('foo');
        expectFailure(promise, done, 'Session is disposed');
      });

    });

    context('#changeKernel()', () => {

      it('should create a new kernel with the new name', () => {
        let previous = session.kernel;
        let model = createSessionModel(session.id);
        let name = model.kernel.name;
        tester.onRequest = request => {
          if (request.method === 'PATCH') {
            tester.respond(200, model);
          } else {
            tester.respond(200, { name, id: model.kernel.id });
          }
        };
        return session.changeKernel({ name }).then(kernel => {
          expect(kernel.name).to.be(name);
          expect(session.kernel).to.not.be(previous);
        });
      });

      it('should accept the id of the new kernel', () => {
        let previous = session.kernel;
        let model = createSessionModel(session.id);
        let id = model.kernel.id;
        let name = model.kernel.name;
        tester.onRequest = request => {
          if (request.method === 'PATCH') {
            tester.respond(200, model);
          } else {
            tester.respond(200, { name, id });
          }
        };
        return session.changeKernel({ id }).then(kernel => {
          expect(kernel.name).to.be(name);
          expect(kernel.id).to.be(id);
          expect(session.kernel).to.not.be(previous);
        });
      });

      it('should update the session path if it has changed', () => {
        let model = { ...session.model, path: 'foo.ipynb' };
        let name = model.kernel.name;
        let id = model.kernel.id;
        tester.onRequest = request => {
          if (request.method === 'PATCH') {
            tester.respond(200, model);
          } else {
            tester.respond(200, { name, id});
          }
        };
        return session.changeKernel({ name }).then(kernel => {
          expect(kernel.name).to.be(name);
          expect(session.path).to.be(model.path);
          session.dispose();
        });
      });

    });

    context('#shutdown()', () => {

      it('should shut down properly', (done) => {
        session.shutdown().then(done, done);
      });

      it('should emit a terminated signal', (done) => {
        session.shutdown();
        session.terminated.connect(() => {
          done();
        });
      });

      it('should fail for an incorrect response status', (done) => {
        tester.onRequest = () => {
          tester.respond(200, { });
        };
        let promise = session.shutdown();
        expectFailure(promise, done);
      });

      it('should handle a 404 status', (done) => {
        tester.onRequest = () => {
          tester.respond(404, { });
        };
        session.shutdown().then(done, done);
      });

      it('should handle a specific error status', (done) => {
        tester.onRequest = () => {
          tester.respond(410, { });
        };
        session.shutdown().catch(err => {
          let text ='The kernel was deleted but the session was not';
          expect(err.message).to.contain(text);
        }).then(done, done);
      });

      it('should fail for an error response status', (done) => {
        tester.onRequest = () => {
          tester.respond(500, { });
        };
        let promise = session.shutdown();
        expectFailure(promise, done, '');
      });

      it('should fail if the session is disposed', (done) => {
        tester.onRequest = () => {
          tester.respond(204, { });
        };
        session.dispose();
        expectFailure(session.shutdown(), done, 'Session is disposed');
      });

      // it('should dispose of all session instances', () => {
      // TODO: reinstate after swithing to server based tests.
      //   let session2: Session.ISession;
      //   return Session.connectTo(session.id).then(s => {
      //     session2 = s;
      //     tester.onRequest = () => {
      //       tester.respond(204, { });
      //     };
      //     return session.shutdown();
      //   }).then(() => {
      //     expect(session2.isDisposed).to.be(true);
      //   });
      // });

    });

  });

});
