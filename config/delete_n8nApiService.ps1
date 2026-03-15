# stop service
Stop-Service -Name "n8nApiService"

# delete service
sc.exe delete "n8nApiService"