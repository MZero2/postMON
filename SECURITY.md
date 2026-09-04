# Security Policy

## Supported versions

Security updates are provided for the latest published version of PostMON.

## Reporting a vulnerability

Use the repository Security tab and choose **Report a vulnerability** to submit a private report. Do not open a public issue containing exploit details, collection data, credentials, tokens or reports.

Include the affected PostMON version, Windows version, reproduction steps and the minimum sample collection needed to demonstrate the issue. Remove real credentials and personal data before attaching files.

## Data handled by PostMON

PostMON runs Postman collection scripts and sends the network requests defined by the selected collection. Only run collections, environments and globals from sources you trust.

Reports exclude query strings, headers and request/response bodies by default. Full-detail reports can contain credentials, cookies, tokens, personal data and API payloads. Treat those reports as sensitive files.

PostMON has no telemetry and does not upload collections or reports. Network traffic created by a collection is controlled by that collection.
