# AWS SES Setup Guide

This project uses AWS SES as a backup email service when Resend fails.

## Prerequisites

1. AWS Account with SES access
2. SES SMTP credentials (username and password)
3. Verified sender email address in AWS SES
4. Firebase CLI installed

## Setting Up AWS SES Credentials

### 1. Store Credentials as Firebase Secrets

The AWS SES credentials are stored securely using Firebase Secrets Manager. Run the following commands:

```bash
# Navigate to functions directory
cd functions

# Set AWS SES SMTP username
firebase functions:secrets:set AWS_SES_SMTP_USERNAME

# Set AWS SES SMTP password
firebase functions:secrets:set AWS_SES_SMTP_PASSWORD
```

When prompted, enter your AWS SES SMTP credentials.

### 2. Configure Environment Variables (Optional)

You can optionally customize the AWS SES region and sender email by setting environment variables:

```bash
# Set AWS SES region (default: us-east-1)
firebase functions:config:set aws.ses_region="us-east-1"

# Set AWS SES sender email (defaults to RESEND_FROM_EMAIL)
firebase functions:config:set aws.ses_from_email="noreply@yourdomain.com"
```

Or add them to your `.env` file for local development:

```env
AWS_SES_REGION=us-east-1
AWS_SES_FROM_EMAIL=noreply@yourdomain.com
```

### 3. Verify Sender Email in AWS SES

Before sending emails, you must verify your sender email address in AWS SES:

1. Go to AWS SES Console
2. Navigate to "Verified identities"
3. Click "Create identity"
4. Choose "Email address" and enter your sender email
5. Verify the email by clicking the link in the verification email

**Note:** If your AWS SES account is in sandbox mode, you must also verify recipient email addresses.

### 4. Deploy Functions

After setting up the secrets, deploy your functions:

```bash
yarn workspace functions deploy
```

Or from the functions directory:

```bash
cd functions
firebase deploy --only functions
```

## How It Works

The email sending flow works as follows:

1. **Primary Service (Resend)**: First attempts to send via Resend API
2. **Backup Service (AWS SES)**: If Resend fails, automatically falls back to AWS SES
3. **Response**: The API response includes a `provider` field indicating which service was used:
   - `"provider": "resend"` - Email sent via Resend
   - `"provider": "aws-ses"` - Email sent via AWS SES (backup)

## Troubleshooting

### Testing Locally

To test the email function locally with emulators:

```bash
cd functions
yarn serve
```

Make sure to set up local environment variables in `.env` or through Firebase emulator configuration.

### Common Issues

1. **"AccessDenied" error**: Check that your AWS credentials have SES send permissions
2. **"Email address is not verified"**: Verify the sender email in AWS SES console
3. **Sandbox mode restrictions**: If in sandbox, verify recipient emails or request production access
4. **Region mismatch**: Ensure AWS_SES_REGION matches where your verified identities are configured

### Checking Secrets

To verify which secrets are set:

```bash
firebase functions:secrets:access AWS_SES_SMTP_USERNAME
firebase functions:secrets:access AWS_SES_SMTP_PASSWORD
```

## Security Notes

- Never commit AWS credentials to version control
- Use Firebase Secrets for production credentials
- Use environment variables for configuration values
- Rotate credentials regularly
- Monitor AWS CloudWatch for SES activity

## Additional Resources

- [AWS SES Documentation](https://docs.aws.amazon.com/ses/)
- [Firebase Functions Secrets](https://firebase.google.com/docs/functions/config-env#secret-manager)
- [AWS SES SMTP Credentials](https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html)
