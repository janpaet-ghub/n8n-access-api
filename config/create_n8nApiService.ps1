#simple cmd command:
#sc create n8nApiService binpath= "D:\Farbspektrum\n8n\api\access\src\n8nApiService.exe"

#powershell comand:
New-Service -Name "n8nApiService" `
            -BinaryPathName "D:\Farbspektrum\n8n\api\access\src\n8nApiService.exe" `
            -DisplayName "n8nApiService" `
            -Description "n8n Schnittstellen-Service" `
            -StartupType Automatic