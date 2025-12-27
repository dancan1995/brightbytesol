// server.js - Backend Server for Stripe Payment & Outlook Calendar Integration
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Client } = require('@microsoft/microsoft-graph-client');
const { ClientSecretCredential } = require('@azure/identity');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Microsoft Graph API Setup
const credential = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID,
    process.env.AZURE_CLIENT_ID,
    process.env.AZURE_CLIENT_SECRET
);

const graphClient = Client.initWithMiddleware({
    authProvider: {
        getAccessToken: async () => {
            const token = await credential.getToken('https://graph.microsoft.com/.default');
            return token.token;
        }
    }
});

// Create Stripe Checkout Session
app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { name, email, phone, service, date, time, message, amount } = req.body;

        // Create Stripe checkout session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `Bright Byte Solution - ${service.charAt(0).toUpperCase() + service.slice(1)} Package`,
                            description: `Consultation scheduled for ${date} at ${time}`,
                        },
                        unit_amount: amount, // Amount in cents
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${process.env.DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.DOMAIN}/cancel.html`,
            customer_email: email,
            metadata: {
                name,
                phone,
                service,
                date,
                time,
                message: message || 'No message provided',
            },
        });

        res.json({ id: session.id });
    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ error: error.message });
    }
});

// Stripe Webhook Handler
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        // Create Outlook calendar event
        try {
            await createOutlookEvent(session.metadata);
            console.log('Calendar event created successfully');
        } catch (error) {
            console.error('Error creating calendar event:', error);
        }

        // Send confirmation email (optional)
        try {
            await sendConfirmationEmail(session);
            console.log('Confirmation email sent');
        } catch (error) {
            console.error('Error sending confirmation:', error);
        }
    }

    res.json({ received: true });
});

// Create Outlook Calendar Event using Microsoft Graph API
async function createOutlookEvent(metadata) {
    const { name, email, phone, service, date, time, message } = metadata;

    // Parse date and time
    const [hours, minutes] = time.split(':');
    const startDateTime = new Date(date);
    startDateTime.setHours(parseInt(hours), parseInt(minutes), 0);
    
    const endDateTime = new Date(startDateTime);
    endDateTime.setHours(endDateTime.getHours() + 1); // 1-hour meeting

    const event = {
        subject: `Consultation: ${service.charAt(0).toUpperCase() + service.slice(1)} Package - ${name}`,
        body: {
            contentType: 'HTML',
            content: `
                <h2>Client Consultation</h2>
                <p><strong>Client:</strong> ${name}</p>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Phone:</strong> ${phone}</p>
                <p><strong>Service:</strong> ${service.charAt(0).toUpperCase() + service.slice(1)} Package</p>
                <p><strong>Message:</strong></p>
                <p>${message}</p>
                <hr>
                <p><em>Payment confirmed via Stripe</em></p>
            `
        },
        start: {
            dateTime: startDateTime.toISOString(),
            timeZone: 'America/New_York' // EST/EDT
        },
        end: {
            dateTime: endDateTime.toISOString(),
            timeZone: 'America/New_York'
        },
        location: {
            displayName: 'Virtual Meeting (Link to be sent)'
        },
        attendees: [
            {
                emailAddress: {
                    address: email,
                    name: name
                },
                type: 'required'
            }
        ],
        isOnlineMeeting: true,
        onlineMeetingProvider: 'teamsForBusiness'
    };

    // Create event in the specified calendar
    const createdEvent = await graphClient
        .api(`/users/${process.env.ADMIN_EMAIL}/calendar/events`)
        .post(event);

    console.log('Event created:', createdEvent.id);
    return createdEvent;
}

// Send confirmation email via Microsoft Graph API
async function sendConfirmationEmail(session) {
    const { name, email, date, time } = session.metadata;

    const message = {
        message: {
            subject: 'Booking Confirmed - Bright Byte Solution',
            body: {
                contentType: 'HTML',
                content: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <div style="background: linear-gradient(135deg, #0ea5e9, #d946ef); padding: 30px; text-align: center;">
                            <h1 style="color: white; margin: 0;">Booking Confirmed!</h1>
                        </div>
                        <div style="padding: 30px; background: #f9f9f9;">
                            <h2>Hi ${name},</h2>
                            <p>Thank you for booking with Bright Byte Solution! Your appointment has been confirmed.</p>
                            
                            <div style="background: white; padding: 20px; border-radius: 10px; margin: 20px 0;">
                                <h3>Appointment Details:</h3>
                                <p><strong>Date:</strong> ${date}</p>
                                <p><strong>Time:</strong> ${time} EST</p>
                                <p><strong>Duration:</strong> 1 hour</p>
                            </div>
                            
                            <p>A calendar invitation with meeting details will be sent to you shortly.</p>
                            
                            <p>If you need to reschedule or have any questions, please contact us:</p>
                            <ul>
                                <li>Email: admin@brightbytesolution.com</li>
                                <li>Phone: (616) 240-7246</li>
                            </ul>
                            
                            <p>We look forward to meeting with you!</p>
                            
                            <p>Best regards,<br>
                            <strong>Bright Byte Solution Team</strong></p>
                        </div>
                        <div style="background: #333; color: #999; padding: 20px; text-align: center; font-size: 12px;">
                            <p>© ${new Date().getFullYear()} Bright Byte Solution L.L.C. All rights reserved.</p>
                            <p>145 Gold Ave NW, Grand Rapids, MI 49504</p>
                        </div>
                    </div>
                `
            },
            toRecipients: [
                {
                    emailAddress: {
                        address: email,
                        name: name
                    }
                }
            ]
        },
        saveToSentItems: true
    };

    await graphClient
        .api(`/users/${process.env.ADMIN_EMAIL}/sendMail`)
        .post(message);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running' });
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📧 Admin email: ${process.env.ADMIN_EMAIL}`);
    console.log(`💳 Stripe configured: ${!!process.env.STRIPE_SECRET_KEY}`);
    console.log(`📅 Outlook configured: ${!!process.env.AZURE_CLIENT_ID}`);
});

module.exports = app;