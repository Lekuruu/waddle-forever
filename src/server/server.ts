import path from 'path';
import fs from 'fs';
import express, { Request } from 'express';
import net from 'net';

import { XtPacket } from '.';
import { XtHandler } from './handlers';
import loginHandler from './handlers/play/login';
import navigationHandler from './handlers/play/navigation';
import serverList, { getServerPopulation, WORLD_PORT } from './servers';
import commandsHandler from './handlers/commands';
import itemHandler from './handlers/play/item';
import stampHandler from './handlers/play/stamp';
import puffleHandler from './handlers/play/puffle';
import iglooHandler from './handlers/play/igloo';
import epfHandler from './handlers/play/epf';
import mailHandler from './handlers/play/mail';
import { Client } from './penguin';
import { SettingsManager } from './settings';
import { HttpServer } from './http';

const createServer = async (type: string, port: number, handlers: XtHandler): Promise<void> => {
  await new Promise<void>((resolve) => {
    net.createServer((socket) => {
      socket.setEncoding('utf8');
  
      const client = new Client(socket);
  
      socket.on('data', (data: Buffer) => {
        const dataStr = data.toString().split('\0')[0];
        console.log('incoming data!', dataStr);
        if (dataStr.startsWith('<')) {
          if (dataStr === '<policy-file-request/>') {
            socket.end('<cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>');
          } else if (dataStr === "<msg t='sys'><body action='verChk' r='0'><ver v='153' /></body></msg>") {
            client.send('<msg t="sys"><body action="apiOK" r="0"></body></msg>');
          } else if (dataStr === "<msg t='sys'><body action='rndK' r='-1'></body></msg>") {
            client.send('<msg t="sys"><body action="rndK" r="-1"><k>key</k></body></msg>');
          } else if (dataStr.includes('login')) {
            const dataMatch = dataStr.match(/<nick><!\[CDATA\[(.*)\]\]><\/nick>/);
            if (dataMatch === null) {
              socket.end('');
            } else {
              const name = dataMatch[1];
              client.create(name);
              /*
              TODO
              will key be required?
              buddies
              how will server size be handled after NPCs?
              */
              // information regarding how many populations are in each server
              client.sendXt('l', client.id, client.id, '', serverList.map((server) => {
                const population = server.name === 'Blizzard' ? 5 : getServerPopulation()
                return `${server.id},${population}`;
              }).join('|'));
  
              /** TODO puffle stuff */
              client.sendXt('pgu');
            }
          }
        } else {
          const packet = new XtPacket(dataStr);
          const callbacks = handlers.getCallback(packet);
          if (callbacks === undefined) {
            console.log('unhandled XT: ', packet);
          } else {
            callbacks.forEach((callback) => {
              callback(client, ...packet.args);
            });
          }
        }
      });
  
      socket.on('close', () => {
        console.log('A client has disconnected');
      });
  
      socket.on('error', (error) => {
        console.error(error);
      });
    }).listen(port, () => {
      console.log(`${type} server listening on port ${port}`);
      resolve();
    });
  })
};

const startServer = async (settingsManager: SettingsManager): Promise<void> => {
  const server = express();

  const httpServer = new HttpServer(settingsManager);

  // TODO a better system for handling these special medias
  // entrypoint for as2 client
  httpServer.get('/boots.swf', (s) => {
    return `special/boots${s.settings.fps30 ? '30' : '24'}.swf`
  });

  httpServer.get('/play/v2/games/thinice/ThinIce.swf', (s) => {
    let suffix = s.settings.thin_ice_igt ? 'IGT' : 'Vanilla';
    if (s.settings.thin_ice_igt) {
      suffix += s.settings.fps30 ? '30' : '24'
    }
    return `special/ThinIce${suffix}.swf`
  });

  httpServer.get('/play/v2/games/dancing/dance.swf', (s) => {
    return `special/dance_contest/${s.settings.swap_dance_arrow ? 'swapped' : 'vanilla'}.swf`;
  });

  httpServer.get('/', () => `special/index.html`);

  httpServer.get('/play/v2/games/book1/bootstrap.swf', (s) => {
    return `special/my_puffle/${s.settings.modern_my_puffle ? '2013' : 'original'}.swf`
  });

  httpServer.dir('/play/v2/content/global/clothing', (s, d) => {
    return s.settings.clothing ? path.join('clothing', d) : undefined;
  })

  httpServer.get('/play/v2/client/shell.swf', (s) => {
    return `special/shell/${s.settings.remove_idle ? 'no_idle' : 'vanilla'}.swf`
  });

  httpServer.get('/play/v2/games/jetpack/JetpackAdventures.swf', (s) => {
    return `special/jet_pack_adventure/${s.settings.jpa_level_selector ? 'level_selector' : 'vanilla'}.swf`;
  });

  server.use(httpServer.router);

  server.use(express.static('media/static'));

  await new Promise<void>((resolve, reject) => {
    const HTTP_PORT = 80
    server.listen(HTTP_PORT, () => {
      console.log(`HTTP server listening on port ${HTTP_PORT}`);
      resolve();
    }).on('error', (err) => {
      reject(err)
    })
  })

  const worldListener = new XtHandler();
  worldListener.use(loginHandler);
  worldListener.use(navigationHandler);
  worldListener.use(commandsHandler);
  worldListener.use(itemHandler);
  worldListener.use(stampHandler);
  worldListener.use(puffleHandler);
  worldListener.use(iglooHandler);
  worldListener.use(epfHandler);
  worldListener.use(mailHandler);
  await createServer('Login', 6112, new XtHandler());
  await createServer('World', WORLD_PORT, worldListener);
};

export default startServer;