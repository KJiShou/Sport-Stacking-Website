#!/bin/bash

# AWS SES Setup Script for Firebase Functions
# This script helps you set up the required secrets for AWS SES backup email service

set -e

echo "=================================================="
echo "AWS SES Secret Configuration for Firebase Functions"
echo "=================================================="
echo ""
echo "This script will help you configure AWS SES as a backup email service."
echo "You'll need your AWS SES SMTP credentials."
echo ""

# Check if Firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    echo "❌ Error: Firebase CLI is not installed."
    echo "Please install it with: npm install -g firebase-tools"
    exit 1
fi

echo "✅ Firebase CLI found"
echo ""

# Check if user is logged in
if ! firebase projects:list &> /dev/null; then
    echo "❌ Error: Not logged in to Firebase."
    echo "Please run: firebase login"
    exit 1
fi

echo "✅ Logged in to Firebase"
echo ""

# Navigate to functions directory
cd "$(dirname "$0")/functions" || exit

echo "Setting up AWS SES SMTP credentials..."
echo ""
echo "📧 Step 1: Set AWS SES SMTP Username"
echo "Enter your AWS SES SMTP username (Access Key ID):"
firebase functions:secrets:set AWS_SES_SMTP_USERNAME

echo ""
echo "🔐 Step 2: Set AWS SES SMTP Password"
echo "Enter your AWS SES SMTP password (Secret Access Key):"
firebase functions:secrets:set AWS_SES_SMTP_PASSWORD

echo ""
echo "=================================================="
echo "✅ AWS SES secrets configured successfully!"
echo "=================================================="
echo ""
echo "Next steps:"
echo "1. Verify your sender email in AWS SES Console"
echo "2. (Optional) Configure environment variables:"
echo "   firebase functions:config:set aws.ses_region=\"ap-southeast-2\""
echo "   firebase functions:config:set aws.ses_from_email=\"noreply@rankingstack.com\""
echo "3. Deploy your functions:"
echo "   yarn workspace functions deploy"
echo ""
echo "For more details, see AWS_SES_SETUP.md"
echo ""
