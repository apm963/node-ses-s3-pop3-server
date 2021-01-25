import telnet from 'telnet';
import dotenv from 'dotenv';
import { Pop3Handler } from './pop3-handler.js';
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

dotenv.config();

const argv = yargs(hideBin(process.argv))
    .option('port', {
        alias: 'p',
        type: 'number',
        default: 110,
        description: 'Port to run POP3 server on'
    })
    .option('s3-bucket', {
        type: 'string',
        description: 'S3 bucket to use as backend mail system'
    })
    .option('s3-object-prefix', {
        type: 'string',
        description: 'Prefix to filter by objects within bucket'
    })
    .option('verbose', {
        alias: 'v',
        type: 'boolean',
        description: 'Run with verbose logging'
    })
    .demandOption(['port', 's3-bucket'], 'Please provide an S3 bucket and valid port')
    .argv;

const { port, s3Bucket, s3ObjectPrefix } = argv;

const telnetWrite = (client, data) => {
    client.write(data);
    const truncateData = data.length > 52;
    console.debug(`DEBUG - send: '${data.substr(0, 52)}'` + (truncateData ? '...' : ''));
};

const server = telnet.createServer(client => {
    
    const clientMeta = {
        address: client.input.remoteAddress,
        port: client.input.remotePort,
    };
    
    const handler = new Pop3Handler(clientMeta, s3Bucket, s3ObjectPrefix);
    
    // make unicode characters work properly
    client.do.transmit_binary();
    
    // make the client emit 'window size' events
    client.do.window_size();
    
    // listen for the window size events from the client
    client.on('window size', e => {
        if (e.command === 'sb') {
            console.log('telnet window resized to %d x %d', e.width, e.height);
        }
    });
    
    // listen for the actual data from the client
    client.on('data', async b => {
        console.debug(`DEBUG - recv: '${b}'`);
        const res = await handler.processInput(b);
        if (res.shouldWrite) {
            telnetWrite(client, res.output);
        }
    });
    
    handler.on('close', reason => {
        client.end();
        console.debug(`DEBUG - Connection closed ('${clientMeta.address}', ${clientMeta.port}, reason: ${reason})`);
    });
    
    client.write( handler.onConnectMessage() );
    
    console.debug(`DEBUG - Connected by ('${clientMeta.address}', ${clientMeta.port})`);
    
});

server.on('error', err => {
    if (err.code === 'EACCES') {
        console.error('%s: You must be "root" to bind to port %d', err.code, port);
    } else {
        throw err;
    }
});

server.on('listening', () => {
    console.log('telnet server listening on port %d', port);
    console.log('  $ telnet localhost' + (port != 23 ? ' ' + port : ''));
});

server.listen(port);
