import { nextTick } from 'process';
import AWS from 'aws-sdk';

export class Pop3Handler {
    
    /**
     * 
     * @param {{ address: string, port: number }} clientMeta
     * @param {string} s3Bucket
     * @param {null | string} s3ObjectPrefix
     * @param {AWS.S3 | null} s3Client
     */
    constructor(clientMeta, s3Bucket, s3ObjectPrefix = null, s3Client = null) {
        
        /** @type {{ address: string, port: number }} */
        this.clientMeta = clientMeta;
        
        /** @type {{ [eventName: string]: ((...args: any) => void)[] }} */
        this.eventCallbacks = {};
        
        this.username = '';
        this.loginValidated = false;
        
        /** @type {AWS.S3} */
        this.s3Client = s3Client ?? new AWS.S3();
        this.s3Bucket = s3Bucket;
        this.s3ObjectPrefix = s3ObjectPrefix;
        
        /**
         * @description UIDs of all messages (S3 objects) in this mailbox
         * @type { {uid: string, key: string, size: number}[] }
         */
        this.messageList = [];
        
        /**
         * @description Object contents of all (Partial) messages (S3 objects) in this mailbox
         * @type {{ [uid: string]: undefined | {data: unknown, size: number, top: string, bot: string} }}
         */
        this.messages = {};
        
        this.on('login', async () => {
            console.debug(`Successful login from user '${this.username}'`);
            await this.populateMessageList(this.s3Bucket, this.s3ObjectPrefix);
        });
        
        return this;
    }
    
    on(eventName, cb) {
        this.eventCallbacks[eventName] = this.eventCallbacks[eventName] ?? [];
        this.eventCallbacks[eventName].push(cb);
        return this;
    }
    
    async emit(eventName, ...data) {
        if (eventName in this.eventCallbacks) {
            await Promise.all(this.eventCallbacks[eventName].map(cb => cb(...data)));
        }
        return this;
    }
    
    onConnectMessage() {
        return '+OK nodejs POP3 server ready';
    }
    
    /** @param inputBuffer {Buffer} */
    async processInput(inputBuffer) {
        
        const ret = {
            shouldWrite: true,
            output: '',
        };
        
        let output = '-ERR'; // Default to error
        
        const inputStr = inputBuffer.toString().trim().replace(/\\r$/, '');
        const [, command, args] = inputStr.match(/^(\S+)\s*(.*)\s*$/) ?? [inputStr];
        
        const eol = "\r\n";
        
        // Spec here: https://www.ietf.org/rfc/rfc1939.txt
        switch ((command ?? '').trim().toUpperCase()) {
            case '': {
                ret.shouldWrite = false;
                break;
            }
            case 'CAPA': {
                output = '-ERR';
                break;
            }
            case 'USER': {
                if (args !== this.username) {
                    this.loginValidated = false;
                }
                this.username = args;
                output = '+OK user accepted';
                break;
            }
            case 'PASS': {
                const loginRes = this.performLogin(args);
                if (loginRes) {
                    this.loginValidated = true;
                    await this.emit('login');
                    output = '+OK pass accepted';
                }
                else {
                    output = '+ERR pass denied';
                }
                break;
            }
            case 'STAT': {
                output = `+OK ${this.messageList.length} ${this.messageList.reduce((carry, item) => carry + item.size, 0)}`;
                break;
            }
            case 'LIST': {
                if (args) {
                    // Requested a specific message number
                    const messageMeta = this.messageList[args - 1];
                    if (messageMeta) {
                        output = `+OK ${args} ${messageMeta.size}`;
                    }
                    else {
                        output = `-ERR no such message, only ${this.messageList.length} messages in maildrop`;
                    }
                }
                else {
                    // List all
                    output = `+OK ${this.messageList.length} messages (${this.messageList.reduce((carry, item) => carry + item.size, 0)} octets)${eol}${Object.values(this.messageList).map((d, i) => `${i+1} ${d.size}`).join(eol)}`;
                }
                break;
            }
            case 'UIDL': {
                if (args) {
                    // Requested a specific message number
                    const messageMeta = this.messageList[args - 1];
                    if (messageMeta) {
                        output = `+OK ${args} ${messageMeta.uid}`;
                    }
                    else {
                        output = `-ERR no such message, only ${this.messageList.length} messages in maildrop`;
                    }
                }
                else {
                    // List all
                    output = `+OK${eol}${Object.values(this.messageList).map((d, i) => `${i + 1} ${d.uid}`).join(eol)}${eol}.`;
                }
                break;
            }
            case 'TOP': {
                const [messageNum, numLines] = args.split(/ /g);
                
                if (messageNum > this.messageList.length) {
                    output = '-ERR no such message';
                    break;
                }
                
                const message = await this.getMessageItem(this.s3Bucket, this.messageList[messageNum - 1].uid);
                
                output = `+OK top of message follows${eol}${message.top}${eol}${eol}${ message.bot.slice(0, numLines).join(eol) }${eol}.`;
                break;
            }
            case 'RETR': {
                const messageNum = args;
                
                if (messageNum > this.messageList.length) {
                    output = '-ERR no such message';
                    break;
                }
                
                const message = await this.getMessageItem(this.s3Bucket, this.messageList[messageNum - 1].uid);
                
                output = `+OK ${message.size} octets${eol}${message.data}${eol}.`;
                break;
            }
            case 'DELE': {
                const messageNum = args;
                
                if (messageNum > this.messageList.length) {
                    output = `-ERR message ${messageNum} already deleted`;
                    break;
                }

                const message = await this.getMessageItem(this.s3Bucket, this.messageList[messageNum - 1].uid);
                
                // TODO: Support deleting
                
                output = `+OK message ${messageNum} deleted`;
                break;
            }
            case 'NOOP': {
                output = '+OK';
                break;
            }
            case 'QUIT': {
                output = '+OK nodejs POP3 server signing off';
                // This session will no longer be used - clean up
                // REVIEW: Do we want to move this to a reset() method or similar?
                this.username = '';
                this.loginValidated = false;
                this.messageList = [];
                this.messages = {};
                break;
            }
        }
        
        ret.output = output;
        
        return ret;
    }
    
    performLogin(pass) {
        const username = this.username;
        // TODO: Validate login
        if (pass === 'test') { // username === 'test' && pass === 'pass'
            return true;
        }
        return false;
    }
    
    async populateMessageList(bucket, prefix = null) {
        /** @type {AWS.S3.ListObjectsV2Request} */
        const opts = { Bucket: bucket, /*StartAfter*/ };
        if (prefix !== null) {
            opts.Prefix = prefix;
        }
        try {
            const data = await this.s3Client.listObjectsV2(opts).promise();
            
            this.messageList = (data.Contents ?? [])
                .sort((a, b) => a.LastModified.getTime() - b.LastModified.getTime())
                .map(s3ObjectMeta => ({
                    uid: (s3ObjectMeta.Key ?? '').substr((prefix ?? '').length).replace(/^\/+/, ''),
                    key: (s3ObjectMeta.Key ?? ''),
                    size: s3ObjectMeta.Size,
                }))
                .filter(objectProps => objectProps.uid !== 'AMAZON_SES_SETUP_NOTIFICATION')
                .map(objectProps => ({...objectProps, uid: `${objectProps.uid}_d1`})); // DEBUG: We are using this as a cache-breaker during the development process
            
            console.debug(`Completed populateMessageList('${bucket}', '${prefix}')`);
        }
        catch (err) {
            console.error(err);
        }
    }
    
    /** @throws Error when UID not found in messageList or if there is an error thrown by S3Client */
    async getMessageItem(bucket, uid) {
        
        if (uid in this.messages) {
            // Cache hit
            return this.messages[uid];
        }
        
        // Locate metadata associated with this UID
        const matchedMessageMetadata = this.messageList.filter(messageMetadata => messageMetadata.uid === uid);
        let key = null;
        
        if (matchedMessageMetadata.length > 0) {
            key = matchedMessageMetadata[0].key;
            if (matchedMessageMetadata.length > 1) {
                console.warn(`Multiple metadata elements found in messageList with UID '${uid}'; using the key from the first matched element ('${key}')`);
            }
        }
        else {
            // No matched UIDs found in our messageList
            throw new Error(`UID ${uid} not found in messageList`);
        }
        
        /** @type {AWS.S3.GetObjectRequest} */
        const opts = { Bucket: bucket, Key: key };
        
        // Cache miss
        try {
            const ret = await this.s3Client.getObject(opts).promise();
            const objectBodyBuffer = ret.Body;
            const objectBodyStr = objectBodyBuffer.toString('utf-8');
            
            const [top, ...bot] = objectBodyStr.split('\r\n\r\n');
            
            /** @type {{data: unknown, size: number, top: string, bot: string}} */
            const message = {
                data: objectBodyBuffer,
                size: objectBodyBuffer.length,
                top,
                bot,
            };
            
            // Cache the result
            this.messages[uid] = message;
            console.debug(`Completed getMessageItem('${bucket}', '${uid}')`);
            
            return message;
        }
        catch (err) {
            console.error(err);
            // Rethrow
            throw err;
        }
        
    }
    
}
