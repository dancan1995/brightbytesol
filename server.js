// server.js - Backend Server for Bright Byte Solution Booking System
require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Client } = require('@microsoft/microsoft-graph-client');
const { ClientSecretCredential } = require('@azure/identity');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Stripe webhook - use raw body
app.use('/api/webhook', express.raw({ type: 'application/json' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Bright Byte Solution Booking System is running',
        timestamp: new Date().toISOString()
    });
});

// Create Stripe Checkout Session
app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { name, email, phone, service, date, time, message } = req.body;

        // Validate required fields
        if (!name || !email || !phone || !service || !date || !time) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Service pricing
        const servicePrices = {
            'consultation': 15000, // $150.00
            'starter': 150000,     // $1,500.00
            'professional': 350000, // $3,500.00
            'enterprise': 0        // Custom - handled separately
        };

        const price = servicePrices[service];
        
        if (price === undefined) {
            return res.status(400).json({ error: 'Invalid service selected' });
        }

        if (service === 'enterprise') {
            return res.status(400).json({ 
                error: 'Enterprise packages require custom quote. Please contact us directly.' 
            });
        }

        // Service names for display
        const serviceNames = {
            'consultation': 'Initial Consultation',
            'starter': 'Starter Package',
            'professional': 'Professional Package',
            'enterprise': 'Enterprise Package'
        };

        // Create Stripe checkout session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: serviceNames[service],
                            description: `Appointment on ${date} at ${time}`,
                        },
                        unit_amount: price,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            customer_email: email,
            success_url: `${process.env.DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.DOMAIN}/cancel.html`,
            metadata: {
                customerName: name,
                customerEmail: email,
                customerPhone: phone,
                service: service,
                appointmentDate: date,
                appointmentTime: time,
                projectDetails: message || 'No details provided'
            }
        });

        res.json({ sessionId: session.id, url: session.url });

    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

// Stripe Webhook Handler
app.post('/api/webhook', async (req, res) => {
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
        
        console.log('Payment successful for session:', session.id);
        
        try {
            // Create Outlook calendar event
            await createOutlookEvent(session.metadata);
            
            // Send confirmation email
            await sendConfirmationEmail(session.metadata);
            
            console.log('Calendar event and email sent successfully');
        } catch (error) {
            console.error('Error processing webhook:', error);
            // Don't return error to Stripe - we got the payment
        }
    }

    res.json({ received: true });
});

// Microsoft Graph Client Setup
function getGraphClient() {
    const credential = new ClientSecretCredential(
        process.env.AZURE_TENANT_ID,
        process.env.AZURE_CLIENT_ID,
        process.env.AZURE_CLIENT_SECRET
    );

    const client = Client.initWithMiddleware({
        authProvider: {
            getAccessToken: async () => {
                const token = await credential.getToken('https://graph.microsoft.com/.default');
                return token.token;
            }
        }
    });

    return client;
}

// Create Outlook Calendar Event
async function createOutlookEvent(metadata) {
    const client = getGraphClient();
    
    const { customerName, customerEmail, customerPhone, service, appointmentDate, appointmentTime, projectDetails } = metadata;
    
    // Parse date and time
    const [year, month, day] = appointmentDate.split('-');
    const [hours, minutes] = appointmentTime.split(':');
    
    const startDateTime = new Date(year, month - 1, day, hours, minutes);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); // 1 hour later

    const event = {
        subject: `Client Appointment: ${customerName} - ${service}`,
        body: {
            contentType: 'HTML',
            content: `
                <h2>Client Appointment Details</h2>
                <p><strong>Client Name:</strong> ${customerName}</p>
                <p><strong>Email:</strong> ${customerEmail}</p>
                <p><strong>Phone:</strong> ${customerPhone}</p>
                <p><strong>Service:</strong> ${service}</p>
                <p><strong>Date:</strong> ${appointmentDate}</p>
                <p><strong>Time:</strong> ${appointmentTime}</p>
                <p><strong>Project Details:</strong></p>
                <p>${projectDetails}</p>
                <hr>
                <p><em>Payment confirmed via Stripe</em></p>
            `
        },
        start: {
            dateTime: startDateTime.toISOString(),
            timeZone: 'America/New_York'
        },
        end: {
            dateTime: endDateTime.toISOString(),
            timeZone: 'America/New_York'
        },
        attendees: [
            {
                emailAddress: {
                    address: customerEmail,
                    name: customerName
                },
                type: 'required'
            }
        ],
        location: {
            displayName: 'Microsoft Teams Meeting'
        },
        isOnlineMeeting: true,
        onlineMeetingProvider: 'teamsForBusiness'
    };

    try {
        const createdEvent = await client
            .api(`/users/${process.env.ADMIN_EMAIL}/calendar/events`)
            .post(event);
        
        console.log('Calendar event created:', createdEvent.id);
        return createdEvent;
    } catch (error) {
        console.error('Error creating calendar event:', error);
        throw error;
    }
}

// Send Confirmation Email
async function sendConfirmationEmail(metadata) {
    const client = getGraphClient();
    
    const { customerName, customerEmail, appointmentDate, appointmentTime, service } = metadata;

    const email = {
        message: {
            subject: 'Appointment Confirmed - Bright Byte Solution',
            body: {
                contentType: 'HTML',
                content: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <div style="background: linear-gradient(135deg, #0ea5e9 0%, #d946ef 100%); padding: 30px; text-align: center;">
                            <h1 style="color: white; margin: 0;">Bright Byte Solution</h1>
                            <p style="color: white; margin: 10px 0 0 0;">Data Analytics • Software • Mobile Apps</p>
                        </div>
                        
                        <div style="padding: 30px; background: #f9fafb;">
                            <h2 style="color: #1f2937;">Your Appointment is Confirmed!</h2>
                            <p style="color: #4b5563;">Hi ${customerName},</p>
                            <p style="color: #4b5563;">Thank you for booking with Bright Byte Solution. Your appointment has been confirmed.</p>
                            
                            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #0ea5e9;">
                                <h3 style="margin-top: 0; color: #1f2937;">Appointment Details:</h3>
                                <p style="margin: 5px 0;"><strong>Service:</strong> ${service}</p>
                                <p style="margin: 5px 0;"><strong>Date:</strong> ${appointmentDate}</p>
                                <p style="margin: 5px 0;"><strong>Time:</strong> ${appointmentTime} EST</p>
                                <p style="margin: 5px 0;"><strong>Duration:</strong> 1 hour</p>
                            </div>
                            
                            <div style="background: #eff6ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
                                <p style="margin: 0; color: #1e40af;"><strong>📅 Calendar Invite:</strong> A calendar invitation has been sent to your email with the meeting link.</p>
                            </div>
                            
                            <h3 style="color: #1f2937;">Next Steps:</h3>
                            <ol style="color: #4b5563;">
                                <li>Check your email for the calendar invitation</li>
                                <li>Accept the calendar invite to add it to your calendar</li>
                                <li>Join the meeting using the Microsoft Teams link at the scheduled time</li>
                            </ol>
                            
                            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                                <p style="color: #6b7280; font-size: 14px;">
                                    <strong>Questions?</strong><br>
                                    Email: admin@brightbytesolution.com<br>
                                    Phone: (616) 240-7246
                                </p>
                            </div>
                        </div>
                        
                        <div style="background: #1f2937; padding: 20px; text-align: center;">
                            <p style="color: #9ca3af; margin: 0; font-size: 12px;">
                                © 2024 Bright Byte Solution L.L.C. All rights reserved.<br>
                                145 Gold Ave NW, Grand Rapids, MI 49504
                            </p>
                        </div>
                    </div>
                `
            },
            toRecipients: [
                {
                    emailAddress: {
                        address: customerEmail,
                        name: customerName
                    }
                }
            ]
        }
    };

    try {
        await client
            .api(`/users/${process.env.ADMIN_EMAIL}/sendMail`)
            .post(email);
        
        console.log('Confirmation email sent to:', customerEmail);
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
}

// Start server
app.listen(PORT, () => {
    console.log(`✅ Bright Byte Solution Booking Server running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;