# Node POP3 server for AWS SES + S3

> NB: Authentication has not yet been implemented. As such, this should not be used in production. I plan to implement formal authentication but PRs are welcome.

> Security note: This POP3 implementation currently only supports plaintext `USER` / `PASS`. As such it is highly recommended to not use this in production environments. `APOP` appears to be the next step to improving this (see [spec](https://tools.ietf.org/html/rfc1939#page-15)). I am not sure when I will be able to implement this; PRs welcome.

> Security note: This POP3 implementation does not yet support SSL / TLS. As such it is highly recommended to not use this in production environments. I am not sure when I will be able to implement this. [POP3 Wiki page](https://en.wikipedia.org/wiki/Post_Office_Protocol#STARTTLS) touches on the `STARTTLS` extension (`STLS` command) which allows SSL / TLS on the same port. Alternately POP3S seems to be used for the alt-port method (TCP 995). PRs welcome.

This project is a WIP. The primary purpose of this project is to provide a POP3 server with an AWS (or any) S3 bucket as the message storage provider instead of the traditional disk / DB. This allows creation of a barebones AWS SES + S3 inbound mailserver with limited resources.

In the future this may support running within Lambda + API Gateway + Redis (AWS ElastiCache) for serverless support. Each connection's IP/port would be stored in Redis along with the associated user auth data. Each subsequent Lambda invocation will resume the session based on that cached data. A `QUIT` will destroy the session data (and a Redis key TTL will handle situations where the session was not properly closed). There may be issues with the telnet session getting weird with API Gateway + Lambda so this aspect will need to be tested.

TODO: Readme
