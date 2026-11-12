- "Vernika-Workfflows" is the main application folder
- Code and files will be fetch from other folders "automated-blogger", "Blogger-seo-indexer-tool", "seo-automation-pdf" and used in Vernika-Workflows.
- automated-blogger contains the main application of the tool Vernika-Workflows will used that as a main tool
- few updates on Vernika-Workflows, when using automated-blogger there are few updates to do on the tool to integrate others tools ('blogger-seo-indexer-tool','seo-automation-pdf') into them those updates are as follows:
    -    just like automated-blogger other tools also have their own work enviorment to integrate those tools into automated blogger you need to update login page of automated-blogger "Related tool" section under that section instead of redirecting to tools through links integrate application into one repo(Vernika-workflows) so that when user want to use any of the tool so on clicking "Open companion tool" button they redirected to the login page of other tools. 
    - i will push only Vernika_Workflows folder into the repo and deployed to new vercel account and integrate supabase as new database and i will remove other folder including ('automated-blogger','Blogger-seo-indexer-tool','seo-automation-pdf') tool.
    - while creating new supabase i will need schema and other sql quires to integrated all tools into one common dashboard.
        - things to update on the tool application now this Vernika-Workflows tool will be used for the sales so database will only handle application side of data all the data use by user will be saved on their local storage. 
        - I need a requirement file which will contain all the requirements to run this new Vernika-Workflows smoothly for example like api keys used on every tool, integration used on every tool, service account key used on tools so that i can setup that to run this application.
        - These tools use user api key and their service account keys all that is set from the frontend of the tools ensure this that all the tools fetchs keys from the user end save them into database into secure table.
        - To run these tools smoothly which every key is needed will be saved under vercel env variables
        
    MAJOR UPDATE
    - This tool will be used to sell to multiple customer they will buy directly through admin and when purchase is made admin will create their profile and login auth credentials into database
        - To manage this create a new admin Interface which will manage new user accounts that interface will be directly connected to the database and will manage end to end management of that database create default ADMIN USERNAME: rajputs and PASSWORD will be saved into vercel variable.
        - Now this interface will manage new user and existing user for new user admin will create profile and then login auth now there are three tools if user buy any one tool then admin will craete login auth for that only one tool this will be managed through admin interface.
        - also when creating login auth admin will also add login auth expiry date so that user can not be able to login after expiry, these tools are work on monthly subscriptions user can buy monthly or any num of months so when admin will set expiry then user login auth will expire and will not be active until admin change the status from the interface to expired to active
        - When admin create user profile and assign that profile to any tool or all tool and on the home interface their profile card will be shown (Like in 'seo-automation-pdf' under this tool admin as created default profile Tanu as a user you have to use this concept for other tools too so that this tool work as a multi user platform)
        - One more major security update which is that only device at a time will be able to login on this tool that means only one user from one device will be able to use this tool this is the restrcition so that admin can manage this tool more securly also on the admin interface admin can see under sub user management module when they have logged in also from which devices also how much time they had spend on the tool and every logs of the users.
        - the workflow and UX of the admin interface will be 
            - Login
            - new user 
                - new profile and login auth creation and default otp
                - tool assignment
                - tool assignment
                - Expiry date 
            - manage existing user
                - Login auth updation(profile, username, password, and otp)
                - Manual api keys, service account key and other integration keys management from admin end when user is anble to create integration keys and attached them to the tool then admin can do that from admin interface also when admin attaches or saves keys and json files from their end then those keys and files will be saved on secure user keys table under supabase.
                - Expiry management (stauts"expired, reneued, new expiry date", 2 days reminder on thier interface through popup, new expiry date)
                - List of active users
                    - Logs
                    - security management
                    - storage management of secure tables
                    - updation and deletion of old keys saved on secure tables and other tables which are not in user.
                    - data management 
                    - Storage utilized and clean management to clean unnecessart load from database


- Currently all tools are created and managemed by admin for their personal user but to create new Vernika-Workflow admin needs user and user's api keys and json attachment on their profile interface end so that they can use these tools with their own integration.
    - also this is a multi-user interface with multiple profiles and user working on the tool at one time for this you have to act as a engineer and create a proper application end to end so that their will be no mix up on the profiles and working everyone can work on their own work space
    - now some and every tools are using default data do not remove that use can use that as a guide so no updates on that till asked.
    - This Vernika-Workflows should be able to provide end to end working just exactly like they are providing individually on this new update we are just integrating separate repo into common repo with few updates to manage all tools.

- DO NOT USE ANY EMOJI AND TWEAKS AND BROKEN CODE, ACT AS A DEVELOPER AND CRAETE END TO END SECURE APPLICATION WHICH CAN HANDLE MULTIPLE REALTIME USER ON THE SERVER 
- THIS TOOL WILL WORK ON FREE TIER OF VERCEL AND SUPABASE AND OTHER INTEGRATED TOOL FOR STARTING 1 LAKH ACTIVE USERS SO IT SHOULD BE ABLE TO HANDLE TRAFFIC ON THE WEB APPLICATION EVERY REQUIRED FILE AND CODE SHOULD BE PRESENT ON THE REPO FOR EXAMPLE MCP CACHING AND OTHER IMPORTANT CONCEPT OF DEVELOPMETN AND DEPLOYMENT.
- currently all tools are using default username password and otp to login if those are exposed on the repo so remove them i will add them into vercel also highlight whatever data is being exposed on the repo because repo is public also do not mention backend detals and working details on the readme file.